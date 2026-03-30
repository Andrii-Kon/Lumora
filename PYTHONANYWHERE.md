# PythonAnywhere Deploy

This project can be hosted on PythonAnywhere with the Flask app in
`server/lumora_api.py`. The Vite frontend is served from the built `dist/`
folder by Flask, so PythonAnywhere does not need Node.js at runtime.

## 1. Build the frontend before deploy

Run this locally and commit the updated `dist/` output:

```bash
npm run build
```

## 2. Install Python dependencies on PythonAnywhere

In a PythonAnywhere Bash console:

```bash
cd ~/Lumora
pip3.10 install --user -r requirements.txt
```

Use the Python version that matches your PythonAnywhere web app.

## 3. Configure environment variables

Set the same values you use locally for:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SERVICE_ROLE_KEY=
SUPABASE_REDIRECT_URL=
ACCESS_API_BASE=
PORTAL_ENTRY_URL=
PORTAL_AUTH_DELIVERY=email
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
APP_BASE_URL=https://your-pythonanywhere-domain
```

You can export them in the WSGI file or load them from a private `.env`.

## 4. Point the WSGI file at Lumora

In the PythonAnywhere WSGI file, use:

```python
import sys
from pathlib import Path

project_home = Path("/home/yourusername/Lumora")
if str(project_home) not in sys.path:
    sys.path.insert(0, str(project_home))

from server.lumora_api import app as application
```

## 5. Reload the web app

After saving the WSGI file, press **Reload** in the PythonAnywhere Web tab.

## 6. Quick checks

- `https://your-pythonanywhere-domain/api/health`
- `https://your-pythonanywhere-domain/`
- Start a Stripe test checkout from the paywall

## Notes

- The PythonAnywhere deployment uses the Flask backend, not `server/index.js`.
- `PORTAL_AUTH_DELIVERY=email` keeps the Supabase magic-link email-first flow.
- If Supabase email sending hits its rate limit, the backend can still fall back
  to a direct link when `SERVICE_ROLE_KEY` is present.
