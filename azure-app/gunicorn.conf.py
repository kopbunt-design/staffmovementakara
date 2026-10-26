# gunicorn reads this file from the app folder by itself (no Startup Command needed).
# The default was one worker handling one request at a time, so the page's parallel calls queued up.
# Threads suit this app: most of each request is waiting on Azure SQL, and pyodbc releases the GIL meanwhile.
workers = 2
worker_class = "gthread"
threads = 8
timeout = 120
