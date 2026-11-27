# Systemslab.ai comments

Notion-style inline comments for every Systemslab.ai app. People select text and comment on it, or comment on a page as a whole, and reply in threads. An admin of that app works through the open threads, makes the edits themselves, and marks each thread **incorporated** (noting the revision it went into) or **declined** (with a reason). Closed threads stay on record.

Practice uses it first. Lifecycle and Form can add it with a small adapter, described below.

## What is in this repository

| Path | What it is | Where it runs |
|---|---|---|
| `server/` | The comments API: Express + TypeScript, Postgres `comments` schema in the shared Supabase project | One Railway service, e.g. `comments.systemslab.ai` |
| `src/` (repository root) | `@systemslab/comments`, the React package: highlights, the thread panel and the review list | Built into each app's frontend; not deployed on its own |

The service knows nothing about the apps' content. A thread points at a **target** (`app`, `type`, `id`, optionally `rev`), for example `practice / item / PR-SM-001 / rev A`. A thread can also point at an **anchor**: the field, the quoted text, about 32 characters either side, and the start offset. When the text is shown again, the quote is found by its surroundings, so a comment survives edits around it. If the quote itself is edited away, the panel shows the thread as *text has changed* instead of guessing.

The service reads nothing outside its own `comments` schema except Quickbuild's `public.users`, to check sign-in the same way every app does today. Authors' names are stored with their comments, so it never joins to another app's tables.

## Who can do what

- **Anyone signed in to Systemslab.ai** can read comments, start threads and reply.
- **Viewers** (`role = 'viewer'`) can read comments but not write them.
- **Everyone** can edit or delete their own comments. Whoever starts a thread can remove it until someone else replies.
- **Admins of the app** can mark threads incorporated or declined, reopen them, and remove any comment or thread. Systemslab.ai admins (`role = 'admin'`) are admins in every app. To make someone an admin of one app only:

  ```sql
  INSERT INTO comments.app_admins (app, user_id) VALUES ('practice', '<user id>');
  ```

## API

Everything is under `/api` and needs a Systemslab.ai access token (`Authorization: Bearer …`), issued by Quickbuild's sign-in.

| Call | What it does |
|---|---|
| `GET /me?app=practice` | Who you are in this app: `can_comment`, `is_admin` |
| `GET /threads?app=…&target_type=…&target_id=…` | Threads on one target, with their comments |
| `GET /threads?app=…&status=open\|closed\|all` | Every thread in the app (the review list), open threads by default |
| `GET /counts?app=…[&target_type=…]` | Open threads per target, for badges |
| `POST /threads` | Start a thread: `{ app, target_type, target_id, target_rev?, anchor?, body }` |
| `POST /threads/:id/comments` | Reply: `{ body }` |
| `PATCH /threads/:id` | Admin: `{ status: 'incorporated' \| 'declined' \| 'open', note?, resolved_rev? }` |
| `DELETE /threads/:id` | Remove a thread |
| `PATCH /comments/:id`, `DELETE /comments/:id` | Edit or delete a comment |

## Adding comments to an app

1. Install the package from a release tag, and import its styles once:

   ```
   npm install github:stephen424/systemslab-comments#v0.1.0
   ```
   ```ts
   import '@systemslab/comments/styles.css';
   ```

2. Wrap the signed-in part of the app with the provider, passing the app's own token functions:

   ```tsx
   <CommentsProvider apiUrl={COMMENTS_API_URL} app="lifecycle" getToken={getToken} refreshToken={refreshAccessToken}>
   ```

3. Render commentable text, and put the panel next to it:

   ```tsx
   <CommentableText target={{ type: 'requirement', id: req.id, rev: req.rev }} field="text" text={req.text} as="p" />
   <CommentsPanel target={{ type: 'requirement', id: req.id, rev: req.rev }} />
   ```

   `field` names the part of the target the text is, and must stay the same across edits (`statement`, `table.2.1`, …).

4. Give admins the review list: `<ReviewList renderTarget={t => <Link to={…}>{t.id}</Link>} />`. Use `useOpenCounts('requirement')` for badges.

5. Configure the app's deployment:
   - Add the comments API origin to the app's `connect-src` content policy.
   - Add the app's origin to the comments service's `CORS_ORIGINS`, and its name to `APPS`.
   - If this repository is private, the frontend build needs read access to install from GitHub. Add a read-only fine-grained token for this repository as a build variable, and install with `git+https://<token>@github.com/stephen424/systemslab-comments.git#v0.1.0`, or make the repository public. It holds no secrets.

## Deploy the service on Railway

One service in the same Railway project as the apps:

- Source: this repository, **root directory `server`**. Railway reads `server/railway.json`: build `npm run build`, start `npm start`, which runs migrations and then the API. The health check is at `/health`.
- Variables:

  ```
  DATABASE_URL=<the shared Supabase connection string>
  DB_SSL=true
  DB_SSL_CA=<Supabase CA certificate, optional but recommended>
  JWT_SECRET=<same value as the Quickbuild backend>
  CORS_ORIGINS=https://practice.systemslab.ai,https://lifecycle.systemslab.ai,https://form.systemslab.ai
  APPS=practice,lifecycle,form
  ```

- Custom domain: `comments.systemslab.ai`.

Railway stops reading `railway.json` after 1 December 2026. From then on, set the build command, start command and health check path in the service settings instead.

## Releasing the package

Bump `version` in `package.json`, merge, and tag the merge commit `vX.Y.Z`. The apps move to the new version by changing the tag in their `package.json`.

## Running locally and tests

```
cd server && npm install && cp .env.example .env && npm run build && npm start   # http://localhost:5010
cd server && TEST_DATABASE_URL=postgres://… npm test                              # real Postgres
npm install && npm test                                                            # the React package
```
