# Security Specification: Bitácora Cloud Storage

## 1. Data Invariants
- Each user possesses strictly one root document at `/users/{userId}` where `userId` equals `request.auth.uid`.
- No user can read, list, update, or delete another user's document.
- Unauthenticated requests are denied on all paths.
- Document size is guarded and required root fields (`v`, `day`, `ctx`, `tasks`, `notes`) must be present on creation.
- Document updates must ensure identity preservation (`request.auth.uid == userId`).
- Users can delete their own document when deleting their account.

## 2. Dirty Dozen Payloads & Attack Scenarios
1. **Unauthenticated Read**: Attempting `GET /users/userA` without `request.auth` -> Denied.
2. **Cross-User Snooping**: Authenticated user B attempting `GET /users/userA` -> Denied.
3. **Cross-User Overwrite**: Authenticated user B attempting `SET /users/userA` -> Denied.
4. **Cross-User Deletion**: Authenticated user B attempting `DELETE /users/userA` -> Denied.
5. **Wildcard Collection Crawling**: Attempting `LIST /users` or reading any other arbitrary collection -> Denied.
6. **Subcollection Injection**: Attempting to create documents under `/users/{userId}/subcollection` -> Denied.
7. **Malformed State Create**: Writing a document without `v`, `day`, `ctx`, `tasks`, `notes` -> Denied.
8. **Invalid Version Type**: Writing `v` as string instead of integer/number -> Denied.
9. **Oversized Field Attack**: Writing a single string or key exceeding permitted sizes -> Denied.
10. **Array Overflow Attack**: Writing an unbounded tasks array exceeding allowable payload bounds -> Denied.
11. **Impersonated Auth**: Request claiming `userId` with mismatched UID token -> Denied.
12. **System Root Access**: Accessing root paths outside `/users/{userId}` -> Denied.
