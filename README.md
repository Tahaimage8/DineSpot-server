<div align="center">

# DineSpot Server

### REST API for the DineSpot restaurant platform

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-6-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com/)

[Client Repository](https://github.com/Tahaimage8/DineSpot-client)

</div>

## About the Project

This repository contains the REST API for DineSpot, a restaurant discovery, reservation and review platform.

The server is built with Node.js, Express, TypeScript and the MongoDB Native Driver. It provides restaurant, reservation, review and user-management endpoints while using Better Auth session tokens created by the client application.

The API follows a simple single-file structure to keep the project understandable for learning purposes.

## Main Features

- Express REST API
- MongoDB Native Driver
- Better Auth session-token verification
- Customer, restaurant owner and admin authorization
- Restaurant approval workflow
- Reservation status management
- Completed-reservation review validation
- Real average rating and review-count calculation
- Admin user role and account-type management
- User block and unblock functionality
- Protected API access for blocked accounts
- Search and status filtering
- Request validation and ownership checks

## Technology Stack

- **Runtime:** Node.js
- **Server:** Express.js
- **Language:** TypeScript
- **Database:** MongoDB
- **Database Driver:** MongoDB Native Driver
- **Environment Variables:** dotenv
- **Cross-Origin Requests:** CORS
- **Development Tools:** tsx and nodemon

## Project Structure

```text
DineSpot-server/
├── index.ts
├── package.json
├── tsconfig.json
├── .gitignore
└── .env
```

The application uses the following internal order inside `index.ts`:

```text
MongoClient
→ database and collections
→ helper functions
→ authentication middleware
→ restaurant routes
→ admin user routes
→ reservation routes
→ review routes
→ app listener
```

## Database Collections

```text
users
sessions
accounts
restaurants
reservations
reviews
```

The `users`, `sessions` and `accounts` collections are shared with Better Auth.

## Getting Started

### Prerequisites

- Node.js 20 or later
- npm
- MongoDB Atlas database

### Installation

```bash
git clone https://github.com/Tahaimage8/DineSpot-server.git
cd DineSpot-server
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
```

Use the same MongoDB database used by the DineSpot client authentication setup.

Do not commit `.env` or expose the MongoDB connection string publicly.

### Run in Development

```bash
npm run dev
```

The server runs by default at:

```text
http://localhost:5000
```

### Type Check and Build

```bash
npm run type-check
npm run build
```

### Run the Production Build

```bash
npm start
```

## API Overview

### Public Restaurant Routes

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/restaurants` | Get approved restaurants |
| `GET` | `/api/restaurants/:id` | Get one approved restaurant |
| `GET` | `/api/restaurants/:id/reviews` | Get public restaurant reviews |

### Restaurant Owner Routes

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/restaurants` | Create one restaurant |
| `GET` | `/api/my/restaurants` | Get the owner's restaurant |
| `PATCH` | `/api/restaurants/:id` | Update the owner's restaurant |
| `DELETE` | `/api/restaurants/:id` | Delete the owner's restaurant |
| `GET` | `/api/owner/reservations` | Get reservations for the owner's restaurant |
| `PATCH` | `/api/owner/reservations/:id/status` | Confirm, reject or complete a reservation |
| `GET` | `/api/owner/reviews` | Get reviews for the owner's restaurant |

### Customer Routes

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/reservations` | Create a reservation request |
| `GET` | `/api/my/reservations` | Get the customer's reservations |
| `PATCH` | `/api/reservations/:id/cancel` | Cancel an active reservation |
| `POST` | `/api/reviews` | Review a completed reservation |
| `GET` | `/api/my/reviews` | Get the customer's reviews |
| `PATCH` | `/api/reviews/:id` | Update the customer's review |
| `DELETE` | `/api/reviews/:id` | Delete the customer's review |

### Admin Restaurant Routes

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/admin/restaurants` | Get all restaurants |
| `PATCH` | `/api/admin/restaurants/:id/status` | Change restaurant approval status |
| `DELETE` | `/api/admin/restaurants/:id` | Delete a restaurant |

### Admin User Routes

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/admin/users` | Get registered users |
| `PATCH` | `/api/admin/users/:id/role` | Change a user's role |
| `PATCH` | `/api/admin/users/:id/account-type` | Change a user's account type |
| `PATCH` | `/api/admin/users/:id/block` | Block or unblock a user |

### Admin Reservation and Review Routes

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/admin/reservations` | Get all reservations |
| `DELETE` | `/api/admin/reservations/:id` | Delete a reservation |
| `GET` | `/api/admin/reviews` | Get all reviews |
| `DELETE` | `/api/admin/reviews/:id` | Delete a review |

## Authentication

Protected requests require a Better Auth session token:

```http
Authorization: Bearer SESSION_TOKEN
```

The server checks the token in the `sessions` collection, loads the related user and applies the required role middleware.

## Roles and Account Types

### Application Roles

```text
user
admin
```

### User Account Types

```text
customer
restaurant_owner
```

An administrator uses the `admin` role. Normal users use the `user` role together with their account type.

## Reservation Status Flow

```text
pending
→ confirmed
→ completed
```

Other possible outcomes:

```text
pending → rejected
pending or confirmed → cancelled
```

## Review Rules

A customer can submit a review only when:

- The reservation belongs to that customer
- The reservation status is `completed`
- The reservation has not already been reviewed
- The rating is a whole number from 1 to 5
- The comment is not empty

Restaurant `averageRating` and `reviewCount` values are recalculated after review creation, update or deletion.

## Security Rules

- Customers can access only their own reservations and reviews.
- Owners can manage only their own restaurant and related reservations.
- Admin-only routes require the `admin` role.
- An admin cannot change or block their own account through the management routes.
- Blocked users cannot access protected API routes.
- Restaurant IDs, reservation IDs and review IDs are validated before database operations.

## Related Repository

The Next.js frontend is available here:

**DineSpot Client:**  
https://github.com/Tahaimage8/DineSpot-client

## Project Notes

This is a learning and portfolio project designed to demonstrate a complete role-based REST API using Express, TypeScript and MongoDB.

## Author

**Taha Image**

- GitHub: [@Tahaimage8](https://github.com/Tahaimage8)

---

<div align="center">

Built with Express, TypeScript and MongoDB.

</div>