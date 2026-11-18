Test code owned by Wu Jiawei.

functional.mjs
  20 cases: FN-ACC-01 through FN-ACC-06, FN-CHAT-01 through FN-CHAT-06, FN-MEET-01 through FN-MEET-03, FN-WEB-01, FN-SCH-01 through FN-SCH-04.
  This run passed 20/20. The record is functional-results.json.

e2e.mjs
  20 cases: E2E-01 through E2E-12 (accounts, friends, and chat) and E2E-26 through E2E-33 (meetings).
  This run passed 20/20.

fuzz.mjs
  Fuzz testing, seed 20261116. Owned by Wu Jiawei.

Screenshots
  UI-01 through UI-06: login, empty chat, add friend, transfers, meeting lobby, and profile.

How to run
  Put functional.mjs, e2e.mjs, and fuzz.mjs in server/test/ of the ReliaTox project.
  From the project root:

    node server/test/functional.mjs
    node server/test/e2e.mjs
    node server/test/fuzz.mjs

  Each script starts its own temporary server and does not call DeepSeek.
