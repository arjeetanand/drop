# Social Relay pilot

## Product identity

**Drop Relay lets a message travel through people who choose to carry it.** A possible tagline is “Your message. Their journey.” The sender follows the real handoff journey, while the note or media stays private until the named recipient collects the drop.

This is for occasion-based messages such as birthdays, farewells, or reunions, where the sender and recipient may value the journey as part of the gift. Direct delivery remains the better choice when speed is the goal.

## Why it can be more than message or GIF sharing

- The route gives the drop a human story: the recipient can see who chose to carry it.
- Each carrier can add a short note for the next carrier.
- The recipient explicitly collects and opens the drop; carriers only see route details.
- The sender can follow the journey as it happens.

The product promise is the journey and the act of carrying, not a faster way to deliver media.

## Feasibility and identity limits

Drop already has the essential opt-in loop: a signed-in sender issues a one-use invite, each carrier can accept and pass on a new invite, the sender follows the route, and the signed-in recipient collects before opening. The local browser test covers text and GIF journeys.

Drop does not currently read social followers, calculate routes through followers-of-followers, or verify carrier names against Drop accounts. A carrier name is entered by the person accepting the invite. The UI must describe it as a name shown on the route, not as a verified social identity. The recipient may collect before a full chain forms, so describe Relay as an optional journey rather than promising a fixed number of hops. The nearby-carrier preview is simulated and must not be presented as discovered social connections.

Carrier invites are one-use bearer links, not recipient-bound invitations: whoever receives a link may accept it first. The sender or carrier chooses whom to share the link with, but the system does not verify that choice. The pilot should say this plainly and let the carrier decide whether to continue.

Do not claim Relay is more private than a user's existing messaging app. Its potential distinction is the chosen, visible handoff story; privacy guarantees come only from the implementation and should be described narrowly.

Do not make an external follower graph a pilot dependency. A naive four-hop search with 100 candidate connections at each hop can inspect up to 100 million paths before deduplication; overlap may reduce unique accounts, but it does not remove the API, consent, freshness, and privacy problems. X currently documents follower/following endpoints for an approved developer app and prices these reads at $0.01 per returned relationship resource; rates can change ([X follows API](https://docs.x.com/x-api/users/follows/introduction), [X pricing](https://docs.x.com/x-api/getting-started/pricing)). Meta's Instagram Graph API is scoped to professional-account management and does not establish a general-purpose follower graph across arbitrary accounts ([Instagram API documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)). TikTok's Research API exposes follower/following lists only through an approved research program; commercial users are not eligible for that research access ([TikTok Research API FAQ](https://developers.tiktok.com/docs/en/research-api-faq)). Recheck permissions, terms, and pricing before any future integration.

## Pilot scope

- Keep the existing direct-send path and make Relay optional.
- Keep one active route: each person chooses whether to accept and who to invite next.
- Use Drop's one-time invitations and show only people who actually accept.
- Keep message text and media sealed from carriers; collect and open only as the recipient.
- Explain that carrier names are self-entered and show route notes to journey participants.
- Test with a small group that agrees to participate; do not import or scrape contact/follower lists.

## Not in the pilot

- Automatic access to followers or following lists.
- Randomly messaging people or automatically forwarding a drop.
- Branching one drop into many copies.
- Claims that a carrier is a verified account or a confirmed friend-of-friend.

## What to measure

Track invite opens, carrier acceptance, handoffs completed, recipient collection, time to completion, and where journeys stop. After the journey, ask the sender, carriers, and recipient what the route added, whether they would use Relay again, and what felt confusing or intrusive. Compare the experience with direct delivery for a similar message.

Treat this first run as a usability and value test, not proof of broad market demand. Expand only if participants understand the route, complete it without coaching, and can name a reason to choose it over direct sending.

## First validation run

Recruit 5–10 senders for real birthdays, farewells, or reunions. Ask each sender to invite 2–3 willing carriers they already know, then compare Relay with direct delivery for a similar message. Observe invite acceptance, completed handoffs, collection, time, drop-off point, and whether each person would choose Relay again. Do not import contacts or surprise people with unsolicited links.
