export type Role = "admin" | "department_coordinator" | "faculty" | "club";

export type User = {
  username: string;
  name: string;
  role: Role;
  department: string | null;
  faculty_id?: string;
  blurb: string;
};

// Demo accounts. The engine keeps the same list and does all permission checks.
export const USERS: User[] = [
  { username: "admin", name: "Registrar's Office", role: "admin", department: null,
    blurb: "Generates the timetable, approves changes, confirms Spectra decisions" },
  { username: "dean", name: "Dean, Student Affairs", role: "admin", department: null,
    blurb: "Second admin, so admins never approve their own requests" },
  { username: "coord.cse", name: "CSE Department Coordinator", role: "department_coordinator", department: "CSE",
    blurb: "Approves club and faculty requests, proposes CSE class moves" },
  { username: "F01", name: "Dr. Ananya Mishra", role: "faculty", department: "CSE", faculty_id: "F01",
    blurb: "Sees their own timetable, reports unavailability, books guest lectures" },
  { username: "club.robotics", name: "Robotics Club", role: "club", department: null,
    blurb: "Books venues for club events in plain English or Hinglish" },
];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  department_coordinator: "Dept coordinator",
  faculty: "Faculty",
  club: "Club rep",
};

export function findUser(username: string | undefined | null): User | undefined {
  return USERS.find((u) => u.username === username);
}
