#!/bin/bash
# Share Administration System - Start Script
# Prerequisites: MySQL running on localhost:3306

echo "=== Share Administration System ==="
echo ""

# Create database if not exists
echo "1. Creating database..."
mysql -u root -e "CREATE DATABASE IF NOT EXISTS share_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null
echo "   Database ready."

# Start backend
echo "2. Starting backend server on port 8080..."
cd backend
export PATH="/c/Users/$USER/go-install/go/bin:$PATH"
go run ./cmd/ &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 3

# Start frontend
echo "3. Starting frontend dev server on port 5173..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "=== System is running ==="
echo "Frontend: http://localhost:5173"
echo "Backend:  http://localhost:8080"
echo "Login:    admin / admin123"
echo ""
echo "Press Ctrl+C to stop both servers"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
