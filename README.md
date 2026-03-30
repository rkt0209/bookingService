# Booking Service

Manages the complete flight booking lifecycle. When a user books a flight, this service validates seat availability, calculates the total cost, updates remaining seats in the flight inventory, and triggers both an immediate booking confirmation email and a scheduled pre-departure reminder — all via RabbitMQ.

---

## Architecture Overview

```
API Gateway (authenticated request)
  |
  v
BookingService (Port 5000)
  |
  |-- Validate flight + seats ──────────> FlightsandSearch (HTTP GET)
  |-- Decrement seats ─────────────────> FlightsandSearch (HTTP PATCH)
  |-- Get user email ──────────────────> AuthService       (HTTP GET)
  |-- Confirmation email ──────────────> RabbitMQ → ReminderService
  |-- Schedule reminder ───────────────> RabbitMQ → ReminderService
  |
  v
MySQL Database (BOOKING_DB_DEV)
  |-- Bookings table
```

---

## Tech Stack

| Tool | Purpose |
|---|---|
| Node.js + Express 5.2.1 | Server runtime and framework |
| Sequelize 6.37.7 | ORM for MySQL |
| mysql2 3.16.0 | MySQL driver |
| amqplib 0.10.9 | RabbitMQ client (publish messages) |
| axios 1.13.2 | HTTP client for calling other services |
| body-parser 2.2.2 | Request body parsing |
| http-status-codes 2.3.0 | Consistent HTTP status codes |
| morgan 1.10.1 | HTTP request logger |
| dotenv 17.2.3 | Environment variable loading |
| nodemon 3.1.11 | Auto-restart in development |

---

## Database Design

**Database:** `BOOKING_DB_DEV`

### Bookings Table

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | Primary Key, Auto Increment |
| flightId | INTEGER | Required |
| userId | INTEGER | Required |
| status | ENUM | `'InProcess'`, `'Booked'`, `'Cancelled'` — Default: `'InProcess'` |
| noOfSeats | INTEGER | Required, Default: 1 |
| totalCost | INTEGER | Required, Default: 0 |
| createdAt | DATE | Auto-managed |
| updatedAt | DATE | Auto-managed |

---

## API Endpoints

### `POST /bookingservice/api/v1/bookings`

Creates a new booking for a flight.

**Authentication:** Required — `x-access-token` header (validated at API Gateway level).

**Request Body:**
```json
{
  "flightId": 3,
  "userId": 1,
  "noOfSeats": 2
}
```

**Complete Flow:**
```
1. Receive request body { flightId, userId, noOfSeats }

2. Call FlightsService: GET /api/v1/flights/:flightId
   → Validates flight exists
   → Gets flight data: price, totalSeats, departureTime, departureAirportId, arrivalAirportId

3. Validate: noOfSeats <= flight.totalSeats
   → If not enough seats → 400 ServiceError "Insufficient seats available"

4. Calculate: totalCost = flight.price * noOfSeats

5. Create booking record in DB:
   { flightId, userId, noOfSeats, totalCost, status: 'InProcess' }

6. Call FlightsService: PATCH /api/v1/flights/:flightId
   Body: { totalSeats: flight.totalSeats - noOfSeats }
   → Decrements the seat count on the flight

7. Update booking status in DB: 'InProcess' → 'Booked'

8. Call AuthService: GET /api/v1/users/:userId
   → Gets user's email address for notifications

9. Call FlightsService: GET /api/v1/airport/:departureAirportId
   → Gets departure airport name

10. Call FlightsService: GET /api/v1/airport/:arrivalAirportId
    → Gets arrival airport name

11. Publish to RabbitMQ → SEND_BASIC_MAIL
    → Immediate booking confirmation email to user

12. Publish to RabbitMQ → CREATE_TICKET
    → Scheduled reminder email 2 hours before departure

13. Return completed booking object
```

**Response (201):**
```json
{
  "success": true,
  "message": "Successfully booked the flight",
  "data": {
    "id": 42,
    "flightId": 3,
    "userId": 1,
    "status": "Booked",
    "noOfSeats": 2,
    "totalCost": 9800,
    "createdAt": "2026-03-30T10:00:00.000Z",
    "updatedAt": "2026-03-30T10:00:05.000Z"
  }
}
```

**Error Responses:**
- `400` — Missing required fields
- `400` — Not enough seats available
- `404` — Flight not found
- `500` — Inter-service call failed or DB error

---

### `GET /bookingservice/api/v1/bookings/user/:userId`

Retrieves all bookings for a specific user.

**Authentication:** Required — `x-access-token` header (validated at API Gateway level).

**URL Params:**
- `userId` — numeric user ID

**Flow:**
1. BookingRepository queries DB: `findAll({ where: { userId }, order: [['createdAt', 'DESC']] })`
2. Returns all bookings sorted newest first.

**Response (200):**
```json
{
  "success": true,
  "message": "Successfully fetched bookings",
  "data": [
    {
      "id": 42,
      "flightId": 3,
      "userId": 1,
      "status": "Booked",
      "noOfSeats": 2,
      "totalCost": 9800,
      "createdAt": "2026-03-30T10:00:00.000Z",
      "updatedAt": "2026-03-30T10:00:05.000Z"
    }
  ]
}
```

**Error Responses:**
- `500` — DB query failed

---

## RabbitMQ Message Queue

BookingService is a **producer** only — it publishes messages but never consumes them. The ReminderService consumes everything.

### Connection Setup

On startup, BookingService:
1. Connects to RabbitMQ at `MESSAGE_BROKER_URL`
2. Creates a channel
3. Asserts a direct Exchange with name `EXCHANGE_NAME`

### Message 1: `SEND_BASIC_MAIL` (immediate confirmation)

Published immediately after a booking is confirmed.

**Routing Key:** `REMINDER_BINDING_KEY`

**Payload:**
```json
{
  "service": "SEND_BASIC_MAIL",
  "data": {
    "mailFrom": "airlineHelpline@gamil.com",
    "mailTo": "user@example.com",
    "mailSubject": "Booking confirmation Mail",
    "mailBody": "Dear user this is to inform you that your booking for flight from [DepartureAirport] to [ArrivalAirport] has been confirmed."
  }
}
```

ReminderService receives this and sends the email immediately via Gmail SMTP.

### Message 2: `CREATE_TICKET` (scheduled reminder)

Published right after the confirmation message.

**Routing Key:** `REMINDER_BINDING_KEY`

**Payload:**
```json
{
  "service": "CREATE_TICKET",
  "data": {
    "subject": "Ticket Reminder Mail",
    "content": "Dear user this is to remind you of your upcoming flight...",
    "recepientEmail": "user@example.com",
    "notificationTime": "2026-03-30T06:00:00.000Z"
  }
}
```

`notificationTime` is set to `departureTime - 2 hours`.

ReminderService stores this as a NotificationTicket with status `PENDING`. Its cron job runs every 2 minutes, picks up tickets where `notificationTime <= now`, and sends the reminder email.

---

## Inter-Service HTTP Calls

| Call | Method | Endpoint | Why |
|---|---|---|---|
| FlightsService | GET | `/api/v1/flights/:id` | Get flight details + seat count + price |
| FlightsService | PATCH | `/api/v1/flights/:id` | Decrement seat count after booking |
| FlightsService | GET | `/api/v1/airport/:id` | Get airport names for email content |
| AuthService | GET | `/api/v1/users/:id` | Get user email for notifications |

Service URLs are configured via environment variables:
- FlightsService: `FLIGHT_SERVICE_PATH` (e.g., `http://localhost:3000/flightservice`)
- AuthService: `USER_SERVICE_PATH` (e.g., `http://localhost:7000/authservice`)

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | Yes | Port the service listens on (e.g., 5000) |
| `FLIGHT_SERVICE_PATH` | Yes | Base URL of FlightsandSearch service |
| `USER_SERVICE_PATH` | Yes | Base URL of AuthService |
| `EXCHANGE_NAME` | Yes | RabbitMQ exchange name (e.g., `AIRLINE_EXCHANGE`) |
| `REMINDER_BINDING_KEY` | Yes | RabbitMQ routing key (e.g., `REMINDER_QUEUE_KEY`) |
| `MESSAGE_BROKER_URL` | Yes | RabbitMQ connection URL (e.g., `amqp://localhost`) |

**.env example:**
```
PORT=5000
FLIGHT_SERVICE_PATH=http://localhost:3000/flightservice
USER_SERVICE_PATH=http://localhost:7000/authservice
EXCHANGE_NAME=AIRLINE_EXCHANGE
REMINDER_BINDING_KEY=REMINDER_QUEUE_KEY
MESSAGE_BROKER_URL=amqp://localhost
```

---

## Database Setup

```bash
# Install dependencies
npm install

# Create the database
cd src
npx sequelize db:create

# Run migrations
npx sequelize db:migrate
```

**Database config** is in `src/config/config.json`:
```json
{
  "development": {
    "username": "YOUR_DB_USER",
    "password": "YOUR_DB_PASSWORD",
    "database": "BOOKING_DB_DEV",
    "host": "127.0.0.1",
    "dialect": "mysql"
  }
}
```

---

## Running the Service

```bash
# Development
npx nodemon src/index.js

# Production
node src/index.js
```

> **Note:** RabbitMQ must be running before starting this service. The connection is established at startup and will throw if the broker is unreachable.

---

## Project Structure

```
BookingService/
├── package.json
├── src/
│   ├── index.js                    # Express app entry point
│   ├── config/
│   │   └── config.json             # Sequelize DB config
│   ├── controllers/
│   │   └── booking-controller.js   # Route handlers
│   ├── migrations/                 # Sequelize migration files
│   ├── models/
│   │   ├── index.js                # Sequelize model loader
│   │   └── booking.js              # Booking model definition
│   ├── repositories/
│   │   └── booking-repository.js   # DB queries for Booking model
│   ├── routes/
│   │   └── v1/
│   │       └── index.js            # Route definitions
│   ├── services/
│   │   └── booking-service.js      # Business logic — orchestrates all steps
│   └── utils/
│       ├── errors/                 # AppError, ServiceError, ValidationError
│       ├── message-queue.js        # RabbitMQ channel setup + publish/consume helpers
│       └── helper.js               # Utility functions
```

---

## Error Handling

Custom error classes:
- `AppError` — base error with message + statusCode
- `ServiceError` — for inter-service call failures or business rule violations (e.g., insufficient seats)
- `ValidationError` — for invalid request data

All errors bubble up to a central error handler and return:
```json
{
  "success": false,
  "message": "Error description",
  "data": {}
}
```

---

## Booking Status Lifecycle

```
Request received
     |
     v
  InProcess   ← Initial status when record is created
     |
     v
  Booked      ← After flight seats decremented successfully
     |
     v
  Cancelled   ← (Future: cancellation endpoint)
```

If seat decrement fails after record creation, the booking remains in `InProcess` and is treated as a failed booking.
