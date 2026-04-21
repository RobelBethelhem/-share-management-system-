# Share Administration System

A comprehensive share administration system built with React (frontend), Go (backend), and MySQL (database).

## Prerequisites

- **Go** 1.22+
- **Node.js** 18+
- **MySQL** 8.0+

## Setup

### 1. Create MySQL Database

```sql
CREATE DATABASE IF NOT EXISTS share_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Configure Backend

Edit `backend/.env` with your MySQL credentials:

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=share_management
JWT_SECRET=your-secret-key
SERVER_PORT=8080
```

### 3. Start Backend

```bash
cd backend
go run ./cmd/
```

The backend will auto-migrate all tables and seed default data (admin user, tax schedules, etc.)

### 4. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

### 5. Login

Open http://localhost:5173 and login with:
- **Username:** admin
- **Password:** admin123

## Modules

1. **Dashboard** - Overview stats, investor categories, foreign nationals, bank capital
2. **Shareholders** - Full CRUD with address, POA, search, filtering
3. **Subscriptions** - Pre-subscription, confirmation, additional, reverse, extend
4. **Allocations** - Round-based allocation from subscriptions
5. **Investments** - Payment recording with Amharic dates, standing instructions
6. **Transfers** - Auto-calculated fees (CGT, service, stamp duty, VAT), batch processing
7. **Dividends** - Collection, blocking, transfer (inheritance/legal), tax/payment returns
8. **Dividend Settings** - Fiscal year config, DPS processing, weighted average calculation
9. **Share Blocks** - Block/release with service fees, guarantee amounts
10. **Certificates** - Recording, printing
11. **AGM** - Attendance tracking with voting power
12. **Authorization** - Approve/reject pending items
13. **Reports** - 15+ report types including statements, tax, top shareholders

## Tech Stack

- **Frontend:** React 19, Ant Design, React Router, Axios, Recharts
- **Backend:** Go, Gin, GORM, JWT Auth
- **Database:** MySQL with auto-migration
