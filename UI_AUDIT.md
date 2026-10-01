# Projects checkout UI review

Reviewed September 30, 2026. These are 20 common signs of a rushed, template-like website, applied to this kiosk. They are a practical checklist drawn from the sources below, not a published ranking. The changes in this review target issues present in the app; the remaining rows record checks that found no issue needing a code change.

| # | Mistake to look for | Projects review |
|---|---|---|
| 1 | Generic branding with no clear identity | Kept the Theta Chi mark, Projects name, and restrained member skins. |
| 2 | Too many competing accent colors | Kept one active skin accent; normalized checkout control geometry so gold stars and skin color still read as one control row. |
| 3 | Inconsistent button sizes and corners | Standardized checkout controls at 44px minimum height, 11px corners, and shared type sizing. |
| 4 | Important actions hidden below decorative content | Moved identity confirmation actions into the card footer; only achievement progress scrolls. |
| 5 | No clear hierarchy | Name and identity stay at the top; progress sits in the middle; the decision stays at the bottom. |
| 6 | Tiny touch targets | Raised quantity, skin removal, shop control, and confirmation targets to at least 44px. |
| 7 | Text too small for a tablet | Kept primary controls at 13px or larger and confirmation names responsive. Some secondary progress labels remain compact but are not actions. |
| 8 | Inconsistent spacing | Gave the checkout control row a common gap and padding; reduced cramped confirmation spacing on short screens. |
| 9 | Content clipped on short screens | Confirmation progress now has its own bounded scroll area and the buttons remain visible. |
| 10 | Navigation that changes meaning between screens | Retained consistent “← Roster” return wording and a visible leaderboard return button. |
| 11 | No feedback while data loads | Confirmation and leaderboard show loading or updating states while their actions remain available. |
| 12 | Empty states that look broken | Retained explicit no-progress and no-star states. |
| 13 | Failure states with no recovery | Added a leaderboard Refresh button and a saved-standings message when refresh fails. |
| 14 | Stale data presented as live | Member and leaderboard caches now refresh sooner; synced orders invalidate server cache immediately. |
| 15 | Needlessly repeated slow requests | Server caches short-lived achievement and leaderboard responses; browser coalesces concurrent leaderboard requests. |
| 16 | Overdone card shadows and hover motion | Reduced the heavy card shadow and product lift; disabled animation for reduced-motion users. |
| 17 | Low contrast or invisible focus | Retained visible keyboard focus outlines and dark text on light member surfaces. Skin colors are accents, not body-text colors. |
| 18 | Mobile zoom disabled | Removed the viewport maximum-scale restriction. |
| 19 | Long names breaking the layout | Truncated the checkout name pill within the control row and preserved its full name in a tooltip. |
| 20 | Click effects delaying actions | Kept the optional sound on the existing click listener; raised its volume without adding asynchronous work to button actions. |

Sources used for the checklist: [Nielsen Norman Group usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/), [visual design principles](https://www.nngroup.com/articles/principles-visual-design/), [good visual design](https://www.nngroup.com/articles/good-visual-design/), [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/), [web.dev input delay](https://web.dev/articles/optimize-input-delay), and [web.dev accessible tap targets](https://web.dev/articles/accessible-tap-targets). The phrase “vibe coded” is used in [this industry critique](https://www.searchenginejournal.com/7-common-ai-website-mistakes-that-are-easy-to-avoid/574196/), but this review evaluates the app against specific usability and visual-design criteria.

Performance limit: a first uncached request still needs Apps Script to read and evaluate Orders. The short server cache and browser prefetch make subsequent visits faster; exact timing depends on spreadsheet size and Apps Script latency. Visual checks and automated tests do not replace a final pass on the actual kiosk tablet.
