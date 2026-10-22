# HR System on Azure App Service (akarahr2) — step 1

Proves the path end to end before moving any data: the existing site is served by a small Python
app on the App Service IT prepared, users sign in with their Microsoft account, and the app can
reach Azure SQL `akarahr2`. The site itself still talks to Supabase until the data is moved.

## App Service settings (already set by IT — names only, values stay in Azure)
| Setting | Source |
|---|---|
| AZURE_SQL_SERVER, AZURE_SQL_DB, AZURE_SQL_USER | App Service |
| AZURE_SQL_PWD | Key Vault `kv-akarahr2` / AZURESQLPWD |
| GRAPH_TENANT_ID, GRAPH_CLIENT_ID | App Service |
| GRAPH_CLIENT_SECRET | Key Vault `kv-akarahr2` / GRAPHCLIENTSECRET |

**Never put a password, connection string or secret in this folder or in git.**

## Startup command (App Service → Configuration → General settings)
```
gunicorn -w 2 -k uvicorn.workers.UvicornWorker app:app
```

## Build + deploy
```
./azure-app/build.sh        # → azure-app/dist.zip (app + site, no secrets)
```
Upload `dist.zip` through the channel IT set up (Deployment Center), with build during deployment on
so `requirements.txt` is installed.

## Check after deploy (signed in)
- `/api/me` → your Microsoft account
- `/api/health` → `{"ok": true, "server": "akarahr2", "database": "akarahr2"}`
