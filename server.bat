@echo off
cd /d %~dp0
start "" http://localhost:8613/
python -m http.server 8613
