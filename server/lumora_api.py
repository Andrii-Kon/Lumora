from __future__ import annotations

import os
import threading
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import requests
import stripe
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from supabase import ClientOptions, create_client
from supabase_auth.errors import AuthApiError, AuthError

ROOT_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT_DIR / "dist"

load_dotenv(ROOT_DIR / ".env")


def _env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def _strip_trailing_slash(value: str) -> str:
    return str(value or "").rstrip("/")


def _normalize_delivery_mode(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"email", "auto", "direct_link"}:
        return normalized
    return "email"


PORT = int(_env("PORT", "5050") or "5050")
APP_BASE_URL = _strip_trailing_slash(_env("APP_BASE_URL", "http://localhost:5173"))
ACCESS_API_BASE = _strip_trailing_slash(
    _env("ACCESS_API_BASE", "https://idealist35.eu.pythonanywhere.com")
)
PORTAL_ENTRY_URL = _strip_trailing_slash(_env("PORTAL_ENTRY_URL") or ACCESS_API_BASE or APP_BASE_URL)
SUPABASE_URL = _strip_trailing_slash(_env("SUPABASE_URL"))
SUPABASE_ANON_KEY = _env("SUPABASE_ANON_KEY")
SERVICE_ROLE_KEY = _env("SERVICE_ROLE_KEY")
SUPABASE_REDIRECT_URL = _strip_trailing_slash(
    _env("SUPABASE_REDIRECT_URL")
    or _env("SUPABASE_REDIRECT")
    or (f"{ACCESS_API_BASE}/auth/callback" if ACCESS_API_BASE else f"{APP_BASE_URL}/auth/callback")
)
PORTAL_AUTH_DELIVERY = _normalize_delivery_mode(_env("PORTAL_AUTH_DELIVERY", "email"))
STRIPE_SECRET_KEY = _env("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = _env("STRIPE_WEBHOOK_SECRET")

if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY
    stripe.api_version = "2026-02-25.clover"


def _create_supabase_server_client(api_key: str):
    if not SUPABASE_URL or not api_key:
        return None
    return create_client(
        SUPABASE_URL,
        api_key,
        options=ClientOptions(
            auto_refresh_token=False,
            persist_session=False,
            flow_type="pkce",
        ),
    )


supabase_otp_client = _create_supabase_server_client(SUPABASE_ANON_KEY)
supabase_admin_client = _create_supabase_server_client(SERVICE_ROLE_KEY)

app = Flask(__name__, static_folder=str(DIST_DIR), static_url_path="")

checkout_drafts: dict[str, dict] = {}
fulfilled_checkouts: dict[str, dict] = {}
fulfillment_requests: dict[str, threading.Event] = {}
fulfillment_results: dict[str, tuple[dict | None, Exception | None]] = {}
fulfillment_lock = threading.Lock()


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin") or "*"
    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Stripe-Signature"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return response


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify(
        {
            "ok": True,
            "stripeConfigured": bool(STRIPE_SECRET_KEY),
            "webhookConfigured": bool(STRIPE_WEBHOOK_SECRET),
            "portalConfigured": bool(ACCESS_API_BASE),
            "supabaseOtpConfigured": bool(supabase_otp_client),
            "supabaseAdminConfigured": bool(supabase_admin_client),
            "portalAuthDelivery": PORTAL_AUTH_DELIVERY,
        }
    )


@app.route("/api/stripe/create-checkout-session", methods=["POST", "OPTIONS"])
def create_checkout_session():
    options_response = _handle_options()
    if options_response:
        return options_response

    if not STRIPE_SECRET_KEY:
        return jsonify({"message": "Add STRIPE_SECRET_KEY to start Stripe Checkout."}), 500

    data = request.get_json(silent=True) or {}
    email = str(data.get("email") or "").strip().lower()
    if not _is_valid_email(email):
        return jsonify({"message": "Please enter a valid email address."}), 400

    quiz = _sanitize_quiz(data.get("quiz"))

    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            customer_email=email,
            billing_address_collection="auto",
            allow_promotion_codes=True,
            locale="auto",
            line_items=[
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": "eur",
                        "unit_amount": 100,
                        "product_data": {
                            "name": "Lumora 7-day preview",
                        },
                    },
                },
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": "eur",
                        "unit_amount": 2999,
                        "recurring": {
                            "interval": "month",
                        },
                        "product_data": {
                            "name": "Lumora membership",
                        },
                    },
                },
            ],
            subscription_data={
                "trial_period_days": 7,
                "metadata": {
                    "source": "lumora-web",
                    "email": email,
                },
            },
            metadata={
                "source": "lumora-web",
                "email": email,
            },
            success_url=_build_return_url(_resolve_app_base_url(), "success"),
            cancel_url=_build_return_url(_resolve_app_base_url(), "cancel"),
        )
    except Exception as exc:
        return jsonify({"message": _get_error_message(exc, "Unable to start Stripe Checkout right now.")}), 500

    checkout_drafts[session.id] = {
        "email": email,
        "quiz": quiz,
    }
    return jsonify({"sessionId": session.id, "url": session.url})


@app.route("/api/stripe/complete-checkout", methods=["POST", "OPTIONS"])
def complete_checkout():
    options_response = _handle_options()
    if options_response:
        return options_response

    if not STRIPE_SECRET_KEY:
        return jsonify({"message": "Add STRIPE_SECRET_KEY to start Stripe Checkout."}), 500

    data = request.get_json(silent=True) or {}
    session_id = str(data.get("sessionId") or "").strip()
    if not session_id:
        return jsonify({"message": "Missing Stripe session ID."}), 400

    try:
        result = _fulfill_checkout_session(session_id, _sanitize_quiz(data.get("quiz")))
        return jsonify(result)
    except Exception as exc:
        status_code = getattr(exc, "statusCode", 500)
        return jsonify({"message": _get_error_message(exc, "Unable to confirm payment right now.")}), status_code


@app.route("/api/stripe/webhook", methods=["POST", "OPTIONS"])
def stripe_webhook():
    options_response = _handle_options()
    if options_response:
        return options_response

    if not STRIPE_SECRET_KEY:
        return jsonify({"message": "Stripe is not configured yet."}), 500

    if not STRIPE_WEBHOOK_SECRET:
        return jsonify({"message": "Add STRIPE_WEBHOOK_SECRET to enable webhooks."}), 501

    signature = request.headers.get("Stripe-Signature")
    if not signature:
        return jsonify({"message": "Missing Stripe signature."}), 400

    payload = request.get_data(cache=False)

    try:
        event = stripe.Webhook.construct_event(payload, signature, STRIPE_WEBHOOK_SECRET)
    except Exception:
        return jsonify({"message": "Unable to verify Stripe webhook signature."}), 400

    try:
        if event["type"] == "checkout.session.completed":
            _fulfill_checkout_session(event["data"]["object"]["id"])
    except Exception as exc:
        return jsonify({"message": _get_error_message(exc, "Webhook processing failed.")}), 500

    return jsonify({"received": True})


@app.route("/", defaults={"path": ""}, methods=["GET"])
@app.route("/<path:path>", methods=["GET"])
def serve_frontend(path: str):
    if path.startswith("api/"):
        return jsonify({"message": "Not found"}), 404

    if not DIST_DIR.exists():
        return (
            "Frontend build is missing. Run `npm run build` before starting the Flask app.",
            500,
        )

    if not path:
        return send_from_directory(DIST_DIR, "index.html")

    safe_path = (DIST_DIR / path).resolve()
    if safe_path.is_file() and DIST_DIR.resolve() in safe_path.parents:
        return send_from_directory(DIST_DIR, path)

    return send_from_directory(DIST_DIR, "index.html")


def _handle_options():
    if request.method == "OPTIONS":
        return ("", 204)
    return None


def _resolve_app_base_url() -> str:
    return _strip_trailing_slash(request.headers.get("Origin") or APP_BASE_URL or "http://localhost:5173")


def _build_return_url(base_url: str, checkout_status: str) -> str:
    parsed = urlparse(base_url or "http://localhost:5173")
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["step"] = "step-24" if checkout_status == "success" else "step-23"
    query["checkout"] = checkout_status
    rebuilt = urlunparse(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path or "/",
            parsed.params,
            urlencode(query),
            parsed.fragment,
        )
    )
    if checkout_status != "success":
        return rebuilt
    separator = "&" if "?" in rebuilt else "?"
    return f"{rebuilt}{separator}session_id={{CHECKOUT_SESSION_ID}}"


def _is_valid_email(value: str) -> bool:
    return "@" in value and "." in value.split("@")[-1]


def _sanitize_quiz(quiz) -> dict:
    if not isinstance(quiz, dict):
        return {}

    cleaned = {}
    for key, value in quiz.items():
        if not key:
            continue
        if isinstance(value, (str, int, float, bool)):
            cleaned[key] = value
        elif isinstance(value, list):
            cleaned[key] = [str(item) for item in value]
    return cleaned


def _fulfill_checkout_session(session_id: str, fallback_quiz: dict | None = None) -> dict:
    cached = fulfilled_checkouts.get(session_id)
    if cached:
        return cached

    with fulfillment_lock:
        cached = fulfilled_checkouts.get(session_id)
        if cached:
            return cached

        wait_event = fulfillment_requests.get(session_id)
        if wait_event is None:
            wait_event = threading.Event()
            fulfillment_requests[session_id] = wait_event
            owner = True
        else:
            owner = False

    if not owner:
        wait_event.wait()
        result, error = fulfillment_results.get(session_id, (None, None))
        if error:
            raise error
        if result is None:
            raise RuntimeError("Unable to confirm payment right now.")
        return result

    try:
        session = stripe.checkout.Session.retrieve(session_id)
        if session.status != "complete" or session.payment_status != "paid":
            error = RuntimeError("Payment has not been completed yet.")
            error.statusCode = 409
            raise error

        email = (
            getattr(session.customer_details, "email", None)
            or getattr(session, "customer_email", None)
            or (session.metadata or {}).get("email")
            or ""
        )
        if not email:
            error = RuntimeError("Stripe checkout is missing the customer email.")
            error.statusCode = 400
            raise error

        draft = checkout_drafts.get(session_id, {})
        quiz = fallback_quiz or _sanitize_quiz(draft.get("quiz"))
        _handoff_portal_access(email, quiz)
        portal_access = _send_portal_magic_link(email)

        result = {
            "actionLink": portal_access["actionLink"],
            "deliveryMethod": portal_access["deliveryMethod"],
            "portalEmail": email,
            "portalUrl": portal_access["portalUrl"],
        }
        fulfilled_checkouts[session_id] = result
        checkout_drafts.pop(session_id, None)
        fulfillment_results[session_id] = (result, None)
        return result
    except Exception as exc:
        fulfillment_results[session_id] = (None, exc)
        raise
    finally:
        with fulfillment_lock:
            event = fulfillment_requests.pop(session_id, None)
            if event:
                event.set()


def _handoff_portal_access(email: str, quiz: dict):
    if not ACCESS_API_BASE:
        return None

    response = requests.post(
        f"{ACCESS_API_BASE}/api/grant-access",
        headers={"Content-Type": "application/json"},
        json={
            "email": email,
            "quiz": quiz,
            "redirect_url": SUPABASE_REDIRECT_URL,
        },
        timeout=20,
    )

    data = {}
    try:
        data = response.json()
    except Exception:
        data = {}

    if response.status_code >= 300:
        error = RuntimeError(data.get("message") or "Unable to grant portal access after payment.")
        error.statusCode = response.status_code or 502
        raise error

    return data


def _send_portal_magic_link(email: str) -> dict:
    metadata = {"source": "lumora-web"}
    otp_error = None

    if PORTAL_AUTH_DELIVERY in {"email", "auto"} and supabase_otp_client:
        try:
            supabase_otp_client.auth.sign_in_with_otp(
                {
                    "email": email,
                    "options": {
                        "email_redirect_to": SUPABASE_REDIRECT_URL,
                        "should_create_user": True,
                        "data": metadata,
                    },
                }
            )
            return {
                "actionLink": None,
                "deliveryMethod": "email",
                "portalUrl": PORTAL_ENTRY_URL,
            }
        except (AuthApiError, AuthError, Exception) as exc:
            otp_error = exc
            if PORTAL_AUTH_DELIVERY == "email" and not supabase_admin_client:
                raise RuntimeError(_get_error_message(exc, "Unable to send a secure portal email."))

    if supabase_admin_client:
        try:
            response = supabase_admin_client.auth.admin.generate_link(
                {
                    "type": "magiclink",
                    "email": email,
                    "options": {
                        "redirect_to": SUPABASE_REDIRECT_URL,
                        "data": metadata,
                    },
                }
            )
            return {
                "actionLink": response.properties.action_link,
                "deliveryMethod": "direct_link",
                "portalUrl": PORTAL_ENTRY_URL,
            }
        except (AuthApiError, AuthError, Exception) as exc:
            raise RuntimeError(
                _get_error_message(
                    exc,
                    _get_error_message(otp_error, "Unable to create a secure portal link."),
                )
            ) from exc

    raise RuntimeError(
        _get_error_message(
            otp_error,
            "Supabase auth is not configured. Add SUPABASE_URL and SERVICE_ROLE_KEY to continue.",
        )
    )


def _get_error_message(error, fallback_message: str) -> str:
    if error is None:
        return fallback_message
    message = getattr(error, "message", None) or str(error)
    return message or fallback_message


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=True)
