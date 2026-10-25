# Database maintenance (manual steps)

Since DEPLOY-PRE-01 the Docker containers **only start the application**. Starting, restarting or recreating a container never
syncs the schema and never seeds data. The two operations below are separate, manual, and should be run only when needed - never
as part of a routine deploy. None of them is needed to start an already-initialised database.

Run the commands from the repository root, against the running stack (`docker compose up` must already be running the service).

## 1. Schema sync - `prisma db push`

Needed only when a `services/<service>/prisma/schema.prisma` change adds something MongoDB must create: a new model (collection) or a
new `@unique` / `@@unique` / `@@index`. A new optional scalar field needs no database change. Review the schema diff first.

```bash
docker compose exec <service> npx prisma db push
```

`<service>` is one of `auth-service`, `user-service`, `course-service`, `order-service`, `payment-service`, `learning-service`,
`ai-service`. If Prisma reports that the change would lose data, **stop**: never add `--accept-data-loss` without a reviewed backup.

## 2. Demo seed - creates sample data, empty databases only

A fresh installation only. Each seed checks the existing data first and creates what is missing; none of them is meant for a database
that already holds real data.

| Service | Command | Behaviour |
|---|---|---|
| auth-service | `docker compose exec auth-service node dist-seed/prisma/seed.js` | creates the demo accounts that do not exist yet |
| user-service | `docker compose exec user-service node dist-seed/prisma/seed.js` | creates the profiles that do not exist yet |
| course-service | `docker compose exec course-service node dist-seed/prisma/seed.js` | does nothing if any course exists |
| learning-service | `docker compose exec learning-service node dist-seed/prisma/seed-paths.js` | does nothing if any learning path **or** final project exists; exits with code 2 (writing nothing) if that check fails; never deletes |

Order on a fresh installation: schema sync of every service first, then `auth-service`, `user-service`, `course-service`, and
`learning-service` last (it reads the course list from the course-service).
