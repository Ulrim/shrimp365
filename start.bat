@echo off
chcp 65001 >nul
title Shrimp365

echo.
echo  ====================================================
echo   🦐  Shrimp365 — 흰다리새우 스마트 양식 플랫폼
echo  ====================================================
echo.

:: Node.js 확인
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  ❌  Node.js가 설치되어 있지 않습니다.
    echo      https://nodejs.org 에서 LTS 버전을 설치해주세요.
    pause
    exit /b 1
)
for /f "tokens=1" %%v in ('node --version') do echo  ✔  Node.js %%v

:: 패키지 설치
if not exist "node_modules" (
    echo  📦  패키지를 설치합니다 (최초 1회, 시간이 걸릴 수 있습니다)...
    npm install
    if %errorlevel% neq 0 (
        echo  ❌  패키지 설치 실패
        pause
        exit /b 1
    )
    echo  ✔  패키지 설치 완료
) else (
    echo  ✔  패키지 이미 설치됨
)

echo.
echo  ====================================================
echo   접속 주소  :  http://localhost:3000
echo.
echo   테스트 계정
echo   - 관리자  : admin@shrimp365.com / test1234
echo   - 운영자  : operator@shrimp365.com / test1234
echo.
echo   종료하려면 Ctrl + C 를 누르세요.
echo  ====================================================
echo.

npm run dev
