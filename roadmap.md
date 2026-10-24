# Roadmap

## Done — Attendance & data-management expansion (2026-10-24)
- [x] Migration: departments, department_members, attendance_checkins (+ RLS, grants, unique per-person-per-day index)
- [x] Server functions: departments CRUD, desk search/clock-in API, self check-in, dashboard analytics
- [x] Attendance dashboard (/s/$spaceId/attendance): today %, 30-day trend, per-department stats, gender breakdown, location tree, recent check-ins, method counts
- [x] Departments page (/s/$spaceId/departments): manual or field-derived membership
- [x] Desk clock-in mode on the desk page (search by name / phone / member code)
- [x] Public self check-in page (/checkin/$spaceId)
- [x] Single-org mode: /spaces auto-redirects into the workspace, simplified sidebar, Platform link kept
- [x] Verified end-to-end in browser (desk clock-in, self check-in, dashboard updates, zero console errors)

## Future candidates (not started)
- Biometric device integration (clock-in API is designed to accept a device method later)
- Bulk department assignment (CSV), department-level export
- Attendance via SMS reminders / Africa's Talking integration
