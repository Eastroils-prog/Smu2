# VentureTrack — The Plan in Plain Words (PRD)

> **What this is:** a simple plan for what we are building and in what order.
> **What it is not:** the app. No app has been built yet.
> The technical version of this plan is in [ARCHITECTURE.md](./ARCHITECTURE.md).
> You never need to read that one. This page is enough.

---

## 1. The idea in one sentence

VentureTrack is a private website where **you (the one boss)** help **people who
are trying to start a business**. You invite them, chat with them, give them
tasks, check their work, and see how far each person has come.

## 2. The restaurant picture

We will use a restaurant to explain everything.

| Restaurant word | What it means in our app |
|---|---|
| **You, the owner** | The administrator. There is only ever one. |
| **Guests** | The participants in your programme. |
| **Front of house** (the dining room) | The screens people see and click on. |
| **Back of house** (the kitchen) | The hidden part that stores everything and does the work. |
| **The locks on the doors** | Security. Each guest gets a private room. No guest can peek into another guest's room. |
| **The guest list** | Invitations. Nobody walks in off the street. You invite every person. |

We will not build the whole restaurant at once. We grow it in three sizes:

1. **Food stand** — tiny, fast, open today.
2. **Small restaurant** — real doors, real tables, real kitchen. You can use it with real people.
3. **Full restaurant** — everything, with a full front and back of house.

---

## 3. Core features

These are the main things the app must do.

### For you, the owner

1. **Invite people.** You type a name and an e-mail. They get a link and pick a password.
2. **See everyone at a glance.** One page shows all your people, who is doing well, and who needs help.
3. **Chat privately.** You have one private chat with each person. Messages show up right away.
4. **Give tasks.** You write a task, set a due date, and pick who it is for.
5. **Check the work.** The person sends their work. You say "approved" or "please fix this".
6. **Track real progress.** A progress bar that only moves when *you* have checked the work. Nobody can move their own bar.
7. **Keep secret notes.** Notes about a person that only you can ever see.
8. **Get reminders.** The app tells you who has gone quiet, what is late, and who asked for help.
9. **See the big picture.** Charts, a calendar, and announcements to everyone.

### For each guest (participant)

1. **Their own home page.** Where they are now, what is due next, and your latest feedback.
2. **Their tasks.** See them, work on them, hand them in. They can attach pictures and files to their work.
3. **Their chats.** A private chat with you, and private chats with other participants.
4. **Their progress.** The stages they have passed and what comes next.
5. **Their profile.** Their name, picture, business idea, and goals.
6. **A "help me" button.** Sends you a request for help.

### The one rule that matters most

**A guest can only see their own things.** Not another guest's tasks, files,
progress, or chats they are not part of. Guests can see each other's names, so
they can message each other, but nothing more. And nobody can make themselves the owner. This rule lives in the
kitchen, behind a locked door, so nobody can get around it by being clever with
the dining room.

---

## 4. The roadmap

### Step 1 — The food stand (the quick win, TODAY)

**What you get:** a version of the app you can open and click through. It looks
like the real thing: the sign-in page, your dashboard, a participant's page, a
chat, and a task list.

**What is pretend:** the people and messages are made-up examples. Nothing is
saved. There are no locks yet. It is like a food stand with a menu board and
plastic sample food. You can see exactly what the restaurant will serve before
we build the kitchen.

**Why do this first:** changing a picture costs minutes. Changing a finished
kitchen costs days. You look, you say "move this" or "I don't need that", and
we fix it while it is cheap.

**What I need from you:** nothing. Just look at it and tell me what feels wrong.

### Step 2 — The small restaurant (a real app you can use)

We build this in four parts. After each part, something real works.

| Part | What we build | Restaurant picture | It is done when… |
|---|---|---|---|
| **2a. Doors and locks** | Sign in with a username and password, invitations, profiles | Real doors, real keys, a guest list | You can invite someone and they can sign in. A stranger cannot get in. |
| **2b. Your office** | Your dashboard, the people list, secret notes | The owner's desk and the reservation book | You can see and sort all your people. Guests cannot reach your notes. |
| **2c. Private chat** | Live messages between you and each person, and between participants | A private line between any two tables | Two people chat live. A third person sees nothing. |
| **2d. Tasks and progress** | Tasks, handing in work with pictures and files, approving, the progress bar | Orders go to the kitchen and come back checked | The whole story below works from start to finish. |

**The story that must work at the end of Step 2:**

> You invite a person → they sign in and fill in their profile → you two chat →
> you give them a task → they hand in their work → you approve it → the progress
> bar moves for both of you. A second guest can see none of it.

When that story works, you have a real app you can use with real people.

**What I will need from you in Step 2** (I will walk you through each one, click by click):

- A free **Supabase** account. Supabase is the ready-made kitchen we rent
  instead of building one from bricks. It stores the data and checks the keys.
- About five minutes to make *yourself* the owner. This is done by hand, once,
  on purpose. It means no button anywhere in the app can ever create an owner.

### Step 3 — The full restaurant

| Part | What we build | Restaurant picture |
|---|---|---|
| **3a. Helpers** | Reminders, a calendar, announcements, the "help me" button, charts | A host who taps your shoulder: "table four has waited too long" |
| **3b. Inspection and opening day** | A full safety check, then putting the app on the real internet | The health inspector visits, then we hang the "Open" sign |

**What I will need from you in Step 3:**

- An **e-mail sending service**, so invitations and "forgot my password" e-mails
  actually arrive. I will tell you which one and how to set it up.
- A place to put the website on the internet. I will suggest a free one.

---

## 5. How we test as we go

After every part, I run four checks, in this order. I do not move on until they pass.

| Check | The question | Restaurant picture |
|---|---|---|
| 1. **The page loads with no errors** | Does it open without anything breaking? | Do the lights turn on? |
| 2. **Buttons and forms work** | Does every button do what it says? | Does the bell ring when you press it? |
| 3. **The real kitchen works** | Is the information really saved and really sent? | Did real food come out, not plastic food? |
| 4. **Security** | Can a guest see something they should not? | Did we try every door to make sure it is locked? |

In Step 1 only checks 1 and 2 apply, because the food stand has no kitchen and
no locks yet.

After each part I will tell you plainly: what I tested, what passed, and what I
have **not** tested yet. I will never say "it works" unless a test showed it.

---

## 6. What is already done

- The plan for the kitchen is drawn (how information is stored and who may see what).
- That plan was tried out on a practice kitchen. 38 lock checks were run and all
  passed. For example: "Can guest A read guest B's messages?" The answer was no.
- **Step 1, the food stand, is built.** You can click through every screen with
  made-up people. It was checked on phone and computer sizes.
- **Not done:** the real kitchen and the real locks. Nothing is saved yet.

---

## 7. Three small choices for you

I have picked an answer for each. If you say nothing, I will use my pick.

1. **What language should the app be in?** My pick: English only. If you want
   another language, tell me *now*. Adding it later is much more work.
2. **How should the progress bar count?** My pick: by stages. Each stage is one
   slice of the bar. A slice fills up as you approve work, and only *you* can
   move someone to the next stage.
3. **What do you want to see first?** My pick: Step 1, the food stand, so you
   can look before we build anything real.

---

## 8. What we are *not* building

So that nothing surprises you later:

- No teams or companies. Only single people.
- No second owner. One boss only.
- No public sign-up page. Invitation only.
- No phone app. It is a website that works well on a phone.
- No payments.
