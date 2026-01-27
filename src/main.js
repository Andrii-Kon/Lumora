import './style.css'
import lottie from 'lottie-web'

const app = document.querySelector('#app')
let lottieInstances = []
let offerTimerId = null
let currentStepId = null
const storageKey = 'lumoraAnswers'
const offerTimerKey = 'lumoraOfferEndsAt'
const answers = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey) || '{}')
  } catch {
    return {}
  }
})()

const isLocalHost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
const portalApiBase =
  (typeof window !== 'undefined' && window.LUMORA_PORTAL_API) ||
  (isLocalHost ? 'http://localhost:5002' : 'https://idealist35.eu.pythonanywhere.com')

const steps = {
  index: '/steps/index.html',
  'step-1': '/steps/step-1.html',
  'step-2': '/steps/step-2.html',
  'step-3': '/steps/step-3.html',
  'step-4': '/steps/step-4.html',
  'step-5': '/steps/step-5.html',
  'step-6': '/steps/step-6.html',
  'step-7': '/steps/step-7.html',
  'step-8': '/steps/step-8.html',
  'step-9': '/steps/step-9.html',
  'step-10': '/steps/step-10.html',
  'step-11': '/steps/step-11.html',
  'step-12': '/steps/step-12.html',
  'step-13': '/steps/step-13.html',
  'step-14': '/steps/step-14.html',
  'step-15': '/steps/step-15.html',
  'step-16': '/steps/step-16.html',
  'step-17': '/steps/step-17.html',
  'step-18': '/steps/step-18.html',
  'step-19': '/steps/step-19.html',
  'step-20': '/steps/step-20.html',
  'step-21': '/steps/step-21.html',
  'step-22': '/steps/step-22.html',
  'step-23': '/steps/step-23.html',
}

const reveal = (root) => {
  const items = [...root.querySelectorAll('[data-animate]')]
  items.forEach((item, index) => {
    item.style.transitionDelay = `${index * 80}ms`
  })
  requestAnimationFrame(() => {
    items.forEach((item) => item.classList.add('is-visible'))
  })
}

const destroyLotties = () => {
  if (!lottieInstances.length) return
  lottieInstances.forEach((instance) => instance.destroy())
  lottieInstances = []
}

const loadLottie = (container, path) => {
  if (!container) return
  const instance = lottie.loadAnimation({
    container,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    path,
    rendererSettings: {
      preserveAspectRatio: 'xMidYMid meet',
    },
  })
  lottieInstances.push(instance)
}

const initLottie = (root) => {
  destroyLotties()
  const hero = root.querySelector('#soulmateAnimation')
  if (hero) {
    loadLottie(hero, '/animations/couple-in-love.json')
  }
  const decision = root.querySelector('[data-decision-animation]')
  if (decision) {
    const value = answers.decision || 'Both'
    const map = {
      Heart: '/animations/decision-heart.json',
      Head: '/animations/decision-brain.json',
      Both: '/animations/decision-scales.json',
    }
    loadLottie(decision, map[value] || map.Both)
  }
}

const initToggleCards = (root, selector) => {
  const cards = [...root.querySelectorAll(selector)].filter(
    (card) => !card.closest('[data-select="multi"]')
  )
  if (!cards.length) return
  const sync = (card) => {
    const key =
      card.dataset.answerKey ||
      card.closest('[data-answer-key]')?.dataset.answerKey
    if (!key) return
    const value =
      card.dataset.answerValue ||
      card.dataset.value ||
      card.querySelector('.option-label')?.textContent?.trim()
    if (!value) return
    answers[key] = value
    sessionStorage.setItem(storageKey, JSON.stringify(answers))
  }
  cards.forEach((card) => {
    card.addEventListener('click', () => {
      cards.forEach((item) => item.classList.remove('is-active'))
      card.classList.add('is-active')
      sync(card)
      autoAdvanceIfNeeded(root)
    })
  })
  const active = cards.find((card) => card.classList.contains('is-active'))
  if (active) {
    sync(active)
  }
}

const initMultiCards = (root) => {
  const lists = [...root.querySelectorAll('[data-select="multi"]')]
  lists.forEach((list) => {
    const cards = [...list.querySelectorAll('.option-card')]
    if (!cards.length) return
    const key = list.dataset.answerKey
    const sync = () => {
      if (!key) return
      const values = cards
        .filter((card) => card.classList.contains('is-active'))
        .map(
          (card) =>
            card.dataset.answerValue ||
            card.dataset.value ||
            card.querySelector('.option-label')?.textContent?.trim()
        )
        .filter(Boolean)
      answers[key] = values
      sessionStorage.setItem(storageKey, JSON.stringify(answers))
    }
    cards.forEach((card) => {
      card.addEventListener('click', () => {
        card.classList.toggle('is-active')
        sync()
      })
    })
    sync()
  })
}

const initRequiredSelections = (root) => {
  const buttons = [...root.querySelectorAll('[data-requires-selection]')]
  if (!buttons.length) return
  buttons.forEach((button) => {
    const selector = button.dataset.requiresSelection
    if (!selector) return
    const container = root.querySelector(selector)
    if (!container) return
    const min = Number(container.dataset.minSelect || 1)
    const update = () => {
      const count = container.querySelectorAll('.option-card.is-active').length
      button.disabled = count < min
    }
    update()
    container.addEventListener('click', () => {
      requestAnimationFrame(update)
    })
  })
}

const initFaqAccordion = (root) => {
  const items = [...root.querySelectorAll('[data-faq-item]')]
  if (!items.length) return
  items.forEach((item) => {
    const button = item.querySelector('[data-faq-toggle]')
    const answer = item.querySelector('[data-faq-answer]')
    if (!button || !answer) return
    const shouldOpen = item.dataset.faqOpen === 'true'
    if (shouldOpen) {
      item.classList.add('is-open')
      button.setAttribute('aria-expanded', 'true')
      answer.hidden = false
      answer.setAttribute('aria-hidden', 'false')
    } else {
      item.classList.remove('is-open')
      button.setAttribute('aria-expanded', 'false')
      answer.hidden = true
      answer.setAttribute('aria-hidden', 'true')
    }
    button.addEventListener('click', () => {
      const isOpen = item.classList.toggle('is-open')
      button.setAttribute('aria-expanded', String(isOpen))
      answer.hidden = !isOpen
      answer.setAttribute('aria-hidden', String(!isOpen))
    })
  })
}

const initPaywall = (root) => {
  const payButtons = [...root.querySelectorAll('.pay-button')]
  if (!payButtons.length) return
  const container = root.querySelector('.checkout-card') || root
  let status = container.querySelector('[data-pay-status]')
  if (!status) {
    status = document.createElement('div')
    status.className = 'pay-status'
    status.dataset.payStatus = 'true'
    status.hidden = true
    const lastButton = payButtons[payButtons.length - 1]
    if (lastButton) {
      lastButton.insertAdjacentElement('afterend', status)
    } else {
      container.appendChild(status)
    }
  }

  const resetButtons = () => {
    payButtons.forEach((button) => {
      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText
      }
      button.disabled = false
      button.classList.remove('is-processing', 'is-paid')
    })
  }

  const setProcessing = (button) => {
    payButtons.forEach((item) => {
      item.disabled = true
    })
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent
    }
    button.textContent = 'Processing...'
    button.classList.add('is-processing')
  }

  const setPaid = (button, actionLink) => {
    payButtons.forEach((item) => {
      item.disabled = true
      item.classList.remove('is-processing')
    })
    button.classList.add('is-paid')
    button.textContent = 'Paid'
    status.classList.remove('is-error')
    status.innerHTML = ''
    if (actionLink) {
      const label = document.createElement('div')
      label.textContent = 'Dev mode: open your login link'
      const link = document.createElement('a')
      link.href = actionLink
      link.textContent = 'Open magic link'
      link.target = '_blank'
      link.rel = 'noopener'
      status.append(label, link)
    } else {
      status.textContent = 'Payment successful. Check your email for access.'
    }
    status.hidden = false
  }

  const grantAccess = async () => {
    const email = answers.email?.trim?.() || ''
    if (!email) {
      return { ok: false, message: 'Please enter your email in the previous step.' }
    }
    const quiz = { ...answers }
    delete quiz.email
    const payload = {
      email,
      quiz,
      redirect_url: `${portalApiBase}/auth/callback`,
    }
    try {
      const response = await fetch(`${portalApiBase}/api/grant-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        let errorMessage = 'Unable to send access email.'
        try {
          const data = await response.json()
          if (data?.message) errorMessage = data.message
        } catch {
          // ignore parsing errors
        }
        return { ok: false, message: errorMessage }
      }
      let data = {}
      try {
        data = await response.json()
      } catch {
        data = {}
      }
      return { ok: true, actionLink: data.action_link }
    } catch (error) {
      return { ok: false, message: 'Network error. Please try again.' }
    }
  }

  payButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.classList.contains('is-processing') || button.classList.contains('is-paid')) {
        return
      }
      status.hidden = true
      resetButtons()
      status.classList.remove('is-error')
      setProcessing(button)
      window.setTimeout(async () => {
        const result = await grantAccess()
        if (!result.ok) {
          resetButtons()
          status.classList.add('is-error')
          status.textContent = result.message
          status.hidden = false
          return
        }
        setPaid(button, result.actionLink)
      }, 1400)
    })
  })
}

const initFlow = (root) => {
  const buttons = root.querySelectorAll('[data-next-step]')
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.getAttribute('data-next-step')
      if (!next) return
      loadStep(next)
    })
  })

  const backButtons = root.querySelectorAll('[data-prev-step]')
  backButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const prev = button.getAttribute('data-prev-step')
      if (!prev) return
      loadStep(prev)
    })
  })
}

const hydrateQualityLine = (root) => {
  const line = root.querySelector('[data-quality-line]')
  if (!line) return
  const value = answers.quality || 'Kindness'
  const tone = {
    Kindness: 'truly compassionate souls.',
    Loyalty: 'steadfast at heart.',
    Intelligence: 'curious and thoughtful.',
    Creativity: 'imaginative spirits.',
    Passion: 'radiant and driven.',
    Empathy: 'deeply understanding souls.',
  }
  const ending = tone[value] || 'thoughtful souls.'
  line.textContent = `People who value ${value} in their soulmate are ${ending}`
}

const hydrateChallengeLine = (root) => {
  const line = root.querySelector('[data-challenge-line]')
  if (!line) return
  const value = answers.challenge || 'Dealing with uncertainty'
  const tone = {
    'Building trust': 'Trust takes time, and that is okay. We help you notice steady, reliable signals.',
    'Finding the right person': 'The right person can feel rare. We narrow the noise to what truly fits.',
    'Keeping the spark alive': 'Keeping the spark alive is about shared rituals and curiosity.',
    'Understanding my needs': 'Understanding your needs is the first step to healthier love.',
    'Letting go of the past': 'Letting go creates space for something new and honest.',
    'Dealing with uncertainty': 'Facing the unknown can feel heavy, but you are not alone. We will find clarity together.',
  }
  line.textContent = tone[value] || 'You are not alone in this challenge.'
}

const getZodiacSign = (dateValue) => {
  if (!dateValue || typeof dateValue !== 'string') return null
  const parts = dateValue.split('-').map((part) => Number(part))
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return null
  const [, month, day] = parts
  if (!month || !day) return null
  const ranges = [
    { sign: 'Capricorn', start: [12, 22], end: [1, 19] },
    { sign: 'Aquarius', start: [1, 20], end: [2, 18] },
    { sign: 'Pisces', start: [2, 19], end: [3, 20] },
    { sign: 'Aries', start: [3, 21], end: [4, 19] },
    { sign: 'Taurus', start: [4, 20], end: [5, 20] },
    { sign: 'Gemini', start: [5, 21], end: [6, 20] },
    { sign: 'Cancer', start: [6, 21], end: [7, 22] },
    { sign: 'Leo', start: [7, 23], end: [8, 22] },
    { sign: 'Virgo', start: [8, 23], end: [9, 22] },
    { sign: 'Libra', start: [9, 23], end: [10, 22] },
    { sign: 'Scorpio', start: [10, 23], end: [11, 21] },
    { sign: 'Sagittarius', start: [11, 22], end: [12, 21] },
  ]
  const inRange = (start, end) => {
    const [startMonth, startDay] = start
    const [endMonth, endDay] = end
    if (startMonth > endMonth) {
      return (
        (month === startMonth && day >= startDay) ||
        (month === endMonth && day <= endDay) ||
        month > startMonth ||
        month < endMonth
      )
    }
    if (month < startMonth || month > endMonth) return false
    if (month === startMonth && day < startDay) return false
    if (month === endMonth && day > endDay) return false
    return true
  }
  const match = ranges.find((range) => inRange(range.start, range.end))
  return match ? match.sign : null
}

const hydrateDecisionLine = (root) => {
  const line = root.querySelector('[data-decision-line]')
  if (!line) return
  const value = answers.decision || 'Both'
  const zodiacSign = getZodiacSign(answers.birthDate)
  const decisionTone = {
    Heart: 'their heart',
    Head: 'their head',
    Both: 'their heart and head',
  }
  const decisionStats = {
    Aries: { Heart: 38, Head: 34, Both: 28 },
    Taurus: { Heart: 32, Head: 40, Both: 28 },
    Gemini: { Heart: 30, Head: 42, Both: 28 },
    Cancer: { Heart: 44, Head: 39, Both: 17 },
    Leo: { Heart: 41, Head: 31, Both: 28 },
    Virgo: { Heart: 24, Head: 48, Both: 28 },
    Libra: { Heart: 36, Head: 34, Both: 30 },
    Scorpio: { Heart: 40, Head: 33, Both: 27 },
    Sagittarius: { Heart: 35, Head: 37, Both: 28 },
    Capricorn: { Heart: 22, Head: 52, Both: 26 },
    Aquarius: { Heart: 28, Head: 44, Both: 28 },
    Pisces: { Heart: 48, Head: 30, Both: 22 },
  }
  if (zodiacSign) {
    const percent =
      decisionStats[zodiacSign]?.[value] || decisionStats[zodiacSign]?.Both || 14
    const zodiacLabel = `${zodiacSign} Sun`
    line.innerHTML = `Based on our data, ${percent}% of <span class="accent">${zodiacLabel}</span> people make decisions using ${decisionTone[value] || 'their heart and head'}.`
    return
  }
  const fallback = {
    Heart:
      'Heart-led decision-makers bring warmth and emotional clarity to relationships. Your intuition keeps the bond sincere.',
    Head:
      'Head-led decision-makers value logic and stability in love. Your grounded perspective helps relationships last.',
    Both:
      'Balanced decision-makers tend to be thoughtful and steady in relationships. It is a rare and valuable combination.',
  }
  line.textContent =
    fallback[value] ||
    'Balanced decision-makers tend to be thoughtful and steady in relationships. It is a rare and valuable combination.'
}

const initOfferTimer = (root) => {
  if (offerTimerId) {
    clearInterval(offerTimerId)
    offerTimerId = null
  }
  const timerWrap = root.querySelector('[data-offer-timer]')
  const timerText = root.querySelector('[data-offer-time]')
  if (!timerWrap || !timerText) return

  const duration = Number(timerWrap.dataset.duration || 900)
  const now = Date.now()
  let endsAt = Number(sessionStorage.getItem(offerTimerKey))
  if (!endsAt || Number.isNaN(endsAt) || endsAt <= now) {
    endsAt = now + duration * 1000
    sessionStorage.setItem(offerTimerKey, String(endsAt))
  }

  const update = () => {
    const remaining = Math.max(0, Math.floor((endsAt - Date.now()) / 1000))
    const minutes = Math.floor(remaining / 60)
    const seconds = String(remaining % 60).padStart(2, '0')
    timerText.textContent = `Ends in ${minutes}:${seconds}`
    if (remaining <= 0) {
      clearInterval(offerTimerId)
      offerTimerId = null
    }
  }

  update()
  offerTimerId = setInterval(update, 1000)
}

const initDateInputs = (root) => {
  const dateInputs = [...root.querySelectorAll('input[type="date"][data-max-today]')]
  if (!dateInputs.length) return
  const today = new Date()
  const yyyy = today.getFullYear()
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const dd = String(today.getDate()).padStart(2, '0')
  const maxDate = `${yyyy}-${mm}-${dd}`
  dateInputs.forEach((input) => {
    input.max = maxDate
  })
}

const initFieldInputs = (root) => {
  const inputs = [...root.querySelectorAll('[data-answer-key]')].filter((el) =>
    el.matches('input, textarea, select')
  )
  if (!inputs.length) return
  inputs.forEach((input) => {
    const key = input.dataset.answerKey
    if (!key) return
    const existing = answers[key]
    if (typeof existing === 'string' && existing.length) {
      input.value = existing
    }
    const sync = () => {
      answers[key] = input.value
      sessionStorage.setItem(storageKey, JSON.stringify(answers))
    }
    input.addEventListener('input', sync)
    input.addEventListener('change', sync)
  })
}

const initRequiredInputs = (root) => {
  const buttons = [...root.querySelectorAll('[data-requires-input]')]
  if (!buttons.length) return
  buttons.forEach((button) => {
    const selector = button.dataset.requiresInput
    if (!selector) return
    const input = root.querySelector(selector)
    if (!input) return
    const update = () => {
      const valid = input.checkValidity() && Boolean(input.value)
      button.disabled = !valid
    }
    update()
    input.addEventListener('input', update)
    input.addEventListener('change', update)
  })
}

const getNextStepId = () => {
  if (!currentStepId) return null
  if (currentStepId === 'index') return 'step-1'
  const match = currentStepId.match(/^step-(\d+)$/)
  if (!match) return null
  const next = `step-${Number(match[1]) + 1}`
  return steps[next] ? next : null
}

const autoAdvanceIfNeeded = (root) => {
  if (root.querySelector('[data-next-step]')) return
  const next = getNextStepId()
  if (!next) return
  loadStep(next)
}

const loadStep = async (stepId) => {
  if (!app) return
  if (!steps[stepId]) return
  currentStepId = stepId
  const url = steps[stepId]
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`Failed to load ${url}`)
    }
    const html = await response.text()
    app.innerHTML = html
    const root = app.firstElementChild || app
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    reveal(root)
    initLottie(root)
    initToggleCards(root, '.choice-card')
    initToggleCards(root, '.option-card')
    initToggleCards(root, '.scale-button')
    initMultiCards(root)
    initRequiredSelections(root)
    initPaywall(root)
    initFlow(root)
    initFaqAccordion(root)
    initDateInputs(root)
    initFieldInputs(root)
    initRequiredInputs(root)
    initOfferTimer(root)
    hydrateQualityLine(root)
    hydrateChallengeLine(root)
    hydrateDecisionLine(root)
  } catch (error) {
    app.innerHTML = `
      <div class="step-shell">
        <div class="step-content">
          <p>Unable to load this step. Please refresh.</p>
        </div>
      </div>
    `
  }
}

loadStep('index')
