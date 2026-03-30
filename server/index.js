import 'dotenv/config'
import express from 'express'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const app = express()

const port = Number(process.env.PORT || 5050)
const appBaseUrl = stripTrailingSlash(process.env.APP_BASE_URL || 'http://localhost:5173')
const accessApiBase = stripTrailingSlash(
  process.env.ACCESS_API_BASE || 'https://idealist35.eu.pythonanywhere.com'
)
const portalEntryUrl = stripTrailingSlash(process.env.PORTAL_ENTRY_URL || accessApiBase || appBaseUrl)
const supabaseUrl = stripTrailingSlash(process.env.SUPABASE_URL || '')
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim()
const serviceRoleKey = process.env.SERVICE_ROLE_KEY?.trim()
const portalAuthDelivery = normalizeDeliveryMode(process.env.PORTAL_AUTH_DELIVERY || 'email')
const supabaseRedirectUrl = stripTrailingSlash(
  process.env.SUPABASE_REDIRECT_URL ||
    process.env.SUPABASE_REDIRECT ||
    (accessApiBase ? `${accessApiBase}/auth/callback` : `${appBaseUrl}/auth/callback`)
)
const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim()
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()

const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      apiVersion: '2026-02-25.clover',
    })
  : null

const createSupabaseServerClient = (apiKey) => {
  if (!supabaseUrl || !apiKey) return null
  return createClient(supabaseUrl, apiKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}

const supabaseOtpClient = createSupabaseServerClient(supabaseAnonKey)
const supabaseAdminClient = createSupabaseServerClient(serviceRoleKey)

const checkoutDrafts = new Map()
const fulfilledCheckouts = new Map()
const fulfillmentRequests = new Map()

app.use((request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', request.headers.origin || '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Stripe-Signature')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (request.method === 'OPTIONS') {
    response.sendStatus(204)
    return
  }
  next()
})

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (request, response) => {
  if (!stripe) {
    response.status(500).json({ message: 'Stripe is not configured yet.' })
    return
  }

  if (!stripeWebhookSecret) {
    response.status(501).json({ message: 'Add STRIPE_WEBHOOK_SECRET to enable webhooks.' })
    return
  }

  const signature = request.headers['stripe-signature']
  if (!signature) {
    response.status(400).json({ message: 'Missing Stripe signature.' })
    return
  }

  let event
  try {
    event = stripe.webhooks.constructEvent(request.body, signature, stripeWebhookSecret)
  } catch (error) {
    response.status(400).json({ message: 'Unable to verify Stripe webhook signature.' })
    return
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await fulfillCheckoutSession(event.data.object.id)
    }
    response.json({ received: true })
  } catch (error) {
    response.status(500).json({ message: getErrorMessage(error, 'Webhook processing failed.') })
  }
})

app.use(express.json({ limit: '100kb' }))

app.get('/api/health', (request, response) => {
  response.json({
    ok: true,
    stripeConfigured: Boolean(stripe),
    webhookConfigured: Boolean(stripeWebhookSecret),
    portalConfigured: Boolean(accessApiBase),
    supabaseOtpConfigured: Boolean(supabaseOtpClient),
    supabaseAdminConfigured: Boolean(supabaseAdminClient),
    portalAuthDelivery,
  })
})

app.post('/api/stripe/create-checkout-session', async (request, response) => {
  if (!stripe) {
    response.status(500).json({ message: 'Add STRIPE_SECRET_KEY to start Stripe Checkout.' })
    return
  }

  const email = String(request.body?.email || '')
    .trim()
    .toLowerCase()
  if (!isValidEmail(email)) {
    response.status(400).json({ message: 'Please enter a valid email address.' })
    return
  }

  const quiz = sanitizeQuiz(request.body?.quiz)

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      billing_address_collection: 'auto',
      allow_promotion_codes: true,
      locale: 'auto',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: 100,
            product_data: {
              name: 'Lumora 7-day preview',
            },
          },
        },
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: 2999,
            recurring: {
              interval: 'month',
            },
            product_data: {
              name: 'Lumora membership',
            },
          },
        },
      ],
      subscription_data: {
        trial_period_days: 7,
        metadata: {
          source: 'lumora-web',
          email,
        },
      },
      metadata: {
        source: 'lumora-web',
        email,
      },
      success_url: buildReturnUrl(resolveAppBaseUrl(request), 'success'),
      cancel_url: buildReturnUrl(resolveAppBaseUrl(request), 'cancel'),
    })

    checkoutDrafts.set(session.id, {
      email,
      quiz,
      createdAt: Date.now(),
    })

    response.json({
      sessionId: session.id,
      url: session.url,
    })
  } catch (error) {
    response.status(500).json({
      message: getErrorMessage(error, 'Unable to start Stripe Checkout right now.'),
    })
  }
})

app.post('/api/stripe/complete-checkout', async (request, response) => {
  if (!stripe) {
    response.status(500).json({ message: 'Add STRIPE_SECRET_KEY to start Stripe Checkout.' })
    return
  }

  const sessionId = String(request.body?.sessionId || '').trim()
  if (!sessionId) {
    response.status(400).json({ message: 'Missing Stripe session ID.' })
    return
  }

  try {
    const result = await fulfillCheckoutSession(sessionId, sanitizeQuiz(request.body?.quiz))
    response.json(result)
  } catch (error) {
    const message = getErrorMessage(error, 'Unable to confirm payment right now.')
    const statusCode = error?.statusCode || 500
    response.status(statusCode).json({ message })
  }
})

const server = app.listen(port)

server.on('listening', () => {
  console.log(`Stripe API listening on http://localhost:${port}`)
})

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Set a different PORT in .env and restart npm run dev.`)
    return
  }
  console.error(error)
})

server.ref()

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function normalizeDeliveryMode(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (normalized === 'email' || normalized === 'auto' || normalized === 'direct_link') {
    return normalized
  }
  return 'email'
}

function resolveAppBaseUrl(request) {
  return stripTrailingSlash(request.headers.origin || appBaseUrl || 'http://localhost:5173')
}

function buildReturnUrl(baseUrl, checkoutStatus) {
  const url = new URL(baseUrl || 'http://localhost:5173')
  url.searchParams.set('step', 'step-23')
  url.searchParams.set('checkout', checkoutStatus)
  const urlString = url.toString()
  if (checkoutStatus !== 'success') {
    return urlString
  }
  return `${urlString}&session_id={CHECKOUT_SESSION_ID}`
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function sanitizeQuiz(quiz) {
  if (!quiz || typeof quiz !== 'object' || Array.isArray(quiz)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(quiz).flatMap(([key, value]) => {
      if (!key) return []
      if (typeof value === 'string') return [[key, value]]
      if (typeof value === 'number' || typeof value === 'boolean') return [[key, value]]
      if (Array.isArray(value)) return [[key, value.map((item) => String(item))]]
      return []
    })
  )
}

async function fulfillCheckoutSession(sessionId, fallbackQuiz = {}) {
  if (fulfilledCheckouts.has(sessionId)) {
    return fulfilledCheckouts.get(sessionId)
  }

  if (fulfillmentRequests.has(sessionId)) {
    return fulfillmentRequests.get(sessionId)
  }

  const promise = (async () => {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.status !== 'complete' || session.payment_status !== 'paid') {
      const error = new Error('Payment has not been completed yet.')
      error.statusCode = 409
      throw error
    }

    const email =
      session.customer_details?.email || session.customer_email || session.metadata?.email || ''
    if (!email) {
      const error = new Error('Stripe checkout is missing the customer email.')
      error.statusCode = 400
      throw error
    }

    const draft = checkoutDrafts.get(sessionId)
    const quiz =
      Object.keys(fallbackQuiz || {}).length > 0 ? fallbackQuiz : sanitizeQuiz(draft?.quiz || {})
    await handoffPortalAccess(email, quiz)
    const portalAccess = await sendPortalMagicLink(email)

    const result = {
      actionLink: portalAccess.actionLink,
      deliveryMethod: portalAccess.deliveryMethod,
      portalEmail: email,
      portalUrl: portalAccess.portalUrl,
    }

    fulfilledCheckouts.set(sessionId, result)
    checkoutDrafts.delete(sessionId)
    return result
  })()

  fulfillmentRequests.set(sessionId, promise)

  try {
    return await promise
  } finally {
    fulfillmentRequests.delete(sessionId)
  }
}

function getErrorMessage(error, fallbackMessage) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallbackMessage
}

async function handoffPortalAccess(email, quiz) {
  if (!accessApiBase) {
    return null
  }

  const response = await fetch(`${accessApiBase}/api/grant-access`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      quiz,
      redirect_url: supabaseRedirectUrl,
    }),
  })

  let data = {}
  try {
    data = await response.json()
  } catch {
    data = {}
  }

  if (!response.ok) {
    const error = new Error(data?.message || 'Unable to grant portal access after payment.')
    error.statusCode = response.status || 502
    throw error
  }

  return data
}

async function sendPortalMagicLink(email) {
  const metadata = {
    source: 'lumora-web',
  }

  let otpError = null
  if (portalAuthDelivery !== 'direct_link' && supabaseOtpClient) {
    const { error } = await supabaseOtpClient.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: supabaseRedirectUrl,
        shouldCreateUser: true,
        data: metadata,
      },
    })

    if (!error) {
      return {
        actionLink: null,
        deliveryMethod: 'email',
        portalUrl: portalEntryUrl,
      }
    }

    otpError = error
  }

  if (supabaseAdminClient) {
    const { data, error } = await supabaseAdminClient.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        redirectTo: supabaseRedirectUrl,
        data: metadata,
      },
    })

    if (!error) {
      return {
        actionLink: data?.properties?.action_link || null,
        deliveryMethod: 'direct_link',
        portalUrl: portalEntryUrl,
      }
    }

    throw new Error(error.message || getErrorMessage(otpError, 'Unable to create a secure portal link.'))
  }

  throw new Error(
    getErrorMessage(
      otpError,
      'Supabase auth is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY to send magic links.'
    )
  )
}
