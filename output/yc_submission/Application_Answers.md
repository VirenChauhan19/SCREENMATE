# Screenmate application answers

Use the answer paragraphs in the matching online fields. Entries marked FOUNDER INPUT require your facts. Entries marked PROPOSED require your decision. Question headings are a preparation map, not a verified copy of the current signed-in form.

## Company name

Screenmate

## Company description in 50 characters or fewer

AI that fills job applications with your approval

## Product description

Screenmate is a Chrome extension that helps job seekers complete applications on employer websites. It reads the form, fills saved details, and drafts written answers using the applicant's background and the job description. It checks whether each change reached the page and shows the user what changed. Questions that need missing personal facts or decisions are handed back to the user. The user reviews the application and submits it themselves.

## Company website and product access

[FOUNDER INPUT: confirm the public website URL you want YC to use. A deployment is configured in the repository, but its availability and reviewer access have not been verified for this submission.]

[FOUNDER INPUT: paste the final product demo URL and the separate founder video URL after uploading.]

The current product uses a private access key and an unpacked Chrome extension. If providing interactive access, give reviewers tested instructions and a suitable access method through the private application field. Do not publish a shared paid-API key in a video or public document.

## Current location and location after YC

[FOUNDER INPUT: current city and country; intended company location after YC; ability to attend the in-person batch in San Francisco.]

## How far along is the product

Screenmate placed third globally out of 687 submitted projects at AI Tinkerers' Agents Everywhere Hackathon with OpenAI, representing the Atlanta chapter.

Screenmate has a Chrome extension and a web workspace for saving a profile and reviewing CV imports. It supports form scanning, saved-detail filling, written answers, verification, and navigation through supported in-page steps. The repository includes regression checks and a recorded sample workflow. Live-site reliability needs further measurement; sign-in, CAPTCHAs, uploads, unsupported controls, and final submission remain manual.

[FOUNDER INPUT: append the actual launch status, active-user count, paying-customer count, and date of measurement. Do not count test profiles or automated runs as users.]

## How long each founder has worked on this

[FOUNDER INPUT: for each founder, give the start month/year, approximate hours per week, and any full-time start date. Repository commit dates are not a substitute for your work history.]

## Technical work and contributors

[FOUNDER INPUT: identify who built the product, who maintains it, any contractors or non-founder contributors, and the AI coding tools used. State the division of work accurately.]

Technical description if requested: the web workspace and backend use Next.js, React, and TypeScript. The Chrome extension reads form controls and writes values through browser events, then reads them back to check the result. The backend handles policy checks and model requests through OpenRouter; Exa supplies optional company research. Generated answers undergo a separate review against the saved applicant background before automatic filling. This review reduces unsupported claims but does not guarantee factual correctness.

## Why this idea and why you

[FOUNDER INPUT: describe the actual experience that made you build Screenmate. Include a specific repeated problem you encountered, what you tried, and what happened. Do not claim a personal job-search story unless it is yours.]

Product rationale: job applications repeatedly ask for information a candidate already has, then add questions specific to the role. A useful assistant needs to understand both the applicant's background and what the live form is asking. Screenmate brings that context into the page and checks the result of each action.

[FOUNDER INPUT: add concrete evidence of demand: user interviews, observed sessions, repeat use, payment, or a verbatim customer quote with permission.]

## Competitors and the insight behind the product

Alternatives include Simplify, Tsenta, manual entry, and copying answers from a general AI assistant. Simplify already provides autofill and tailored written answers; Tsenta offers broader job-search and application automation. Screenmate focuses on helping a person complete the application they are currently reviewing, with visible changes, checks that values reached the form, and user control over personal decisions and submission. The hypothesis is that accuracy and control matter enough for some applicants to choose this workflow. That preference, and any performance advantage over existing products, still need to be demonstrated with users.

## How the business will make money

PROPOSED answer to approve or replace: Start with a paid subscription for active job seekers who need repeated help with applications and written answers. Test whether users will pay after trying the product on their own applications. Set the price after measuring willingness to pay, repeat use, and the cost of model and research calls. A possible later channel is career-service organizations, but that has not been validated.

[FOUNDER INPUT: replace this proposal with your actual pricing and plans if they exist. State whether anyone has paid.]

## How much the business could make

PROPOSED framework, not a market-size claim: annual revenue depends on the number of paying job seekers, the monthly price, and how many months each person stays subscribed. At an illustrative $15 per paid month and four paid months per year, 100,000 paying people would produce $6 million in annual revenue before refunds and costs. One million would produce $60 million. These are arithmetic scenarios, not a forecast or evidence that those customer counts are reachable. A convincing answer needs your route to those customers and measured paid duration.

[FOUNDER INPUT: choose a defensible price and customer scenario or replace this with your actual business model.]

## How users find the product

[FOUNDER INPUT: give the actual channels, user counts from each, and paid acquisition costs if applicable.]

PROPOSED next experiment: recruit a small group of active job seekers through communities the founder can personally reach. Observe them applying to jobs, fix the most common failures, and measure how many return for another application. Expand through referrals or career-service partnerships only after that workflow is useful. Do not describe this proposed experiment as completed distribution.

## Usage and engagement

[FOUNDER INPUT: number of unique external users; number active during a defined recent period; applications assisted; repeat users; and how those metrics were measured. State explicitly when a metric is not tracked.]

Useful measures to collect: time to complete an application with and without Screenmate, fields needing correction, sessions reaching review, and users returning within seven days. A sample-form recording is not user traction.

## Revenue

[FOUNDER INPUT: answer yes or no; give actual monthly revenue for each period requested by the live form, currency, paying-customer count, and source of revenue. Use zero only where it is true.]

## Previous applications and progress since then

[FOUNDER INPUT: whether you applied before, batch, prior idea, and measurable changes. If never, say so.]

## Accelerator or incubator history

[FOUNDER INPUT: program names, dates, funding, and equity terms; or none if true.]

## Cofounders and team history

[FOUNDER INPUT: founder names, roles, how and when you met, whether you have met in person, and who is full-time. If solo, state that and whether you are seeking a cofounder.]

## Founder accomplishments

Viren Chauhan built Screenmate, which placed third globally out of 687 submitted projects at AI Tinkerers' Agents Everywhere Hackathon with OpenAI. He represented Atlanta, the only U.S. chapter among the top three. The other podium chapters were Hong Kong and Paris.

[FOUNDER INPUT: add another specific achievement if the form asks for accomplishments outside this startup.]

## A time you made an unusual system work in your favor

[FOUNDER INPUT: a real event, your action, and the result. Prepare this only if asked in the current founder profile; do not invent a story.]

## Legal entities and ownership

[FOUNDER INPUT: legal entity names, jurisdictions, incorporation dates, and ownership percentages by founder, employee, and other holder. If not incorporated, say so and give the intended split only if agreed.]

## Investment and fundraising

[FOUNDER INPUT: investment received, investor names, amounts, dates, instruments, terms, and total raised; cash and monthly spending if requested; and any current fundraising discussions. Use the exact figures you can support.]

## Other ideas considered

[FOUNDER INPUT: actual alternatives you considered, or none if true. Do not list invented ideas to fill the field.]

## Why YC and how you heard about it

PROPOSED motivation to adapt: I want help turning the working prototype into a product people use repeatedly and pay for. The immediate priorities are reliable performance on real applications, understanding which job seekers need it most, and finding a repeatable way to reach them.

[FOUNDER INPUT: why YC specifically appeals to you, how you first heard about it, and any person or event that encouraged this application.]

## Longer-term direction if asked

PROPOSED answer to approve: Start with job applications, where saved personal information and role-specific writing meet in one form. If that works, explore other repeated browser workflows that combine stored facts, written responses, and decisions that should remain with the user. Expansion would follow measured user demand.

## AI coding transcript if the form requests one

Use an authentic export of a feature-building session that shows your decisions, implementation, debugging, and validation. Remove secrets and personal data without changing what happened. Do not submit a reconstructed transcript or this application-writing session as evidence of building the product. Confirm that the field appears in your current form before preparing an upload.

