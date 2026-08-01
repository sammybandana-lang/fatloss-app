# House Rules for This Project

These are the rules you (the AI assistant) must follow at all times while working on this project. Read them before doing anything. If something here is unclear, or a request seems to break one of these rules, stop and ask me in plain language instead of guessing.

## What this project is

A web app that helps track fat loss. It does three things:
- Pulls daily nutrition numbers from Lose It summary emails.
- Pulls workouts from the Hevy app.
- Lets a user manually type in their body weight, body-fat %, and tape measurements.

It then shows each user a dashboard and sends a summary to their coach.

**This app has multiple users, and each user must only ever see their own data.** I'm deliberately building it this way as a practice run for a real multi-customer product. The rules under "The most important rule" below are the most important part of the whole project — treat them that way.

## The tools we're using

- **TypeScript** for everything.
- **Next.js** for the web app (the screens and pages).
- **Supabase** for the database, and **Supabase Auth** for logging users in.
- **trigger.dev** for the scheduled background jobs (the Hevy pull, the Lose It email read, the coach summary).
- **Vercel** for hosting the live site.

Don't bring in a new framework, library, or service without asking me first and explaining why it's needed.

## The most important rule: keep every user's data completely separate

One user must **never**, under any circumstances, see or change another user's data. Getting this wrong is the worst thing that can happen in this project. Here's how we guarantee it:

- **Stamp every row with who owns it.** Every table has a column saying which user the row belongs to. Put a database index on that column.
- **Turn on the database's own access control (called Row-Level Security, or "RLS") on every single table.** This makes the *database itself* refuse to hand one user's data to another. So even if there's a buggy line of code in the app, the database still blocks the leak. **The database is the safety net — never rely on the app code alone.**
- **Start locked, then open up.** When you turn RLS on, the table is closed to everyone until you add an explicit rule that says "a user may see their own rows." Grant only what's needed and nothing more.
- **Do it in both places (belt and suspenders).** The database rule is the guaranteed backstop; also check ownership in the backend code for everything else.

## Logging in and knowing who's asking

- There's a login. Every request has to establish who the logged-in user is.
- The backend figures out who the user is **from their verified login only** — never trust the screen to say "I am user X." A screen can lie; a verified login can't.

## Two database keys — use the right one (be very careful)

- The **normal (public) key** respects the separation rules. Use it for anything a logged-in user does.
- There is also a **powerful "master" key** that **ignores the separation rules entirely.** Only ever use it inside trusted background jobs (like the Hevy pull). Never use it to handle a user's request, and never put it anywhere the browser can reach. Using the master key in the wrong place is the single easiest way to leak everyone's data.

## Prove the separation actually works (don't skip this)

- A data leak **won't show up in normal testing**, because a test account can often see everything anyway. So test it on purpose: create two users, put some data under each, then confirm that while logged in as user 1 you get **nothing** belonging to user 2.
- Every time you add a new table, turning on its access control is part of creating it — never a "do it later" task.

## Keep the pieces in their lanes

- **The thinking lives in the back end, never in the screens.** Calculations, data handling, and rules go in the backend — the frontend only shows data and sends what the user types.
- **The screens never talk to the outside directly.** The web pages don't call Hevy, read email, or touch secret keys. Only the background jobs and backend do that.
- **Outside-data work runs as scheduled background jobs**, not inside a web page.

## Be extra careful here — ask me first

- **Secret keys and the master key:** never write them into the code, never print them into logs, never put them where the browser can see them, never save them into the project files. Always read them from environment settings.
- **Never expose the database to the internet with its access rules turned off.**
- **Don't change the database structure** (adding/removing tables or columns) without showing me the plan first — and any new table must have its separation rules turned on from the start.
- **This holds people's personal health numbers.** Never send anyone's data anywhere except their own place in the database and the coach summary they've approved.

## How we work together

- **Explain first, in plain language.** Before you make a change, tell me what you're about to do and why. I want the reasoning, not just code.
- **Reuse before you rebuild.** Check whether something already exists in the project and use it. Don't rebuild what we have.
- **Keep it simple.** Prefer the shortest solution that's still easy to read. No clever tricks that are hard to follow.
- **One change at a time.** Small changes I can review, not giant ones.

## What "tidy" means

- Each function does one thing and stays short (roughly 50 lines or less).
- No copy-pasted duplicate blocks — if you're about to paste the same thing twice, make it reusable instead.
- Don't hide problems by wrapping code in error-catching just to keep it quiet. Handle failures properly or tell me.
- Write a quick test for anything that does real work — the calculations, the data parsing, and the data-separation rules.

## Practice vs. real (two separate setups)

- There are two separate environments: a **practice** one (dev) and the **real live** one (prod).
- Never point practice code at the real database.
- I change the database by editing a tracked file, testing on practice first, then promoting to real. Never hand-edit the real database directly.

## When in doubt

Stop and ask me — in plain language — rather than guessing. Especially for anything about keeping users' data separate, or anything in the "be extra careful" list.
