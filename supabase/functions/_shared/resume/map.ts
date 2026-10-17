// Maps the model's parsed résumé JSON onto application_profiles columns.
// Pure (no I/O) so it runs identically in the edge function and in tests.
import { computeCompleteness } from "./completeness.ts";

type Obj = Record<string, any>;
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const hasAny = (list: string[] | undefined, needles: string[]) =>
  (list || []).filter((s) => typeof s === "string" && needles.some((n) => s.toLowerCase().includes(n)));

export interface ParsedName { first_name: string; middle_name: string; last_name: string; full_name: string }

export function resolveName(parsed: Obj): ParsedName {
  const pi = parsed?.personalInfo || {};
  let first = str(pi.firstName).trim();
  let middle = str(pi.middleName).trim();
  let last = str(pi.lastName).trim();
  let full = str(pi.fullName).trim();
  if (!first && !last && full) {
    const parts = full.replace(/\s+/g, " ").split(" ").filter(Boolean);
    first = parts[0] || "";
    if (parts.length > 1) last = parts[parts.length - 1];
    if (parts.length > 2) middle = parts.slice(1, -1).join(" ");
  }
  if (!full) full = [first, middle, last].filter(Boolean).join(" ");
  return { first_name: first, middle_name: middle, last_name: last, full_name: full };
}

const normalizeEduDate = (d: any) => {
  if (d && typeof d === "object" && "year" in d) return { year: d.year || "", month: d.month || "" };
  if (typeof d === "string") {
    const s = d.trim();
    const ym = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
    if (ym) return { year: ym[2], month: ym[1] };
    const my = s.match(/^(\d{4})[\/\-](\d{1,2})$/);
    if (my) return { year: my[1], month: my[2] };
    const y = s.match(/^(\d{4})$/);
    if (y) return { year: y[1], month: "" };
    return { year: s, month: "" };
  }
  return { year: "", month: "" };
};

export function mapParsedResume(parsed: Obj, opts: { screeningAnswers?: any[] } = {}) {
  const name = resolveName(parsed);
  const pi = parsed?.personalInfo || {};
  const raw = pi.address;
  let address = { line1: "", line2: "", city: "", state: "", postalCode: "", country: "" };
  if (raw && typeof raw === "object") {
    address = {
      line1: raw.line1 || raw.street || "",
      line2: raw.line2 || "",
      city: raw.city || "",
      state: raw.state || "",
      postalCode: raw.postalCode || raw.zip || "",
      country: raw.country || "",
    };
  } else if (typeof raw === "string" && raw) {
    address = { ...address, line1: raw };
  }

  const tech: string[] = arr(parsed?.skills?.technical);
  const soft: string[] = arr(parsed?.skills?.soft);
  const tools: string[] = arr(parsed?.skills?.tools);

  const row = {
    first_name: name.first_name || "Unknown",
    middle_name: name.middle_name || "",
    last_name: name.last_name || "User",
    personal_details: {
      ...pi,
      full_name: name.full_name || "Unknown User",
      fullName: name.full_name || "",
      firstName: name.first_name,
      lastName: name.last_name,
      summary: parsed?.summary || "",
      email: pi.email || "",
      phone: str(pi.phone).replace(/\s+/g, ""),
      phoneExtension: pi.phoneExtension && pi.phoneExtension !== "empty string" ? pi.phoneExtension : "",
      address,
      linkedin: pi.linkedin || "",
      github: pi.github || "",
      portfolio: pi.portfolio || "",
    },
    education_history: arr(parsed?.education).map((edu: Obj) => ({
      degree: edu.degree || "",
      school: edu.school || "",
      fieldOfStudy: edu.fieldOfStudy || "",
      location: edu.location || "",
      startDate: normalizeEduDate(edu.startDate),
      endDate: normalizeEduDate(edu.endDate),
      description: edu.description || "",
      gpa: edu.gpa || "",
      honors: edu.honors || "",
      coursework: edu.coursework || "",
    })),
    work_experience: arr(parsed?.experience).map((exp: Obj) => ({
      jobTitle: exp.jobTitle || "",
      company: exp.company || "",
      location: exp.location || "",
      startDate: exp.startDate || "",
      endDate: exp.endDate || "",
      description: exp.description || "",
      achievements: exp.achievements || [],
      technologies: exp.technologies || [],
      metrics: exp.metrics || [],
    })),
    technical_skills: {
      programming: hasAny(tech, ["java", "javascript", "python", "react", "node", "typescript", "c++", "c#"]),
      frameworks: hasAny(tech, ["react", "angular", "vue", "express", "spring", "django", "flask"]),
      databases: hasAny(tech, ["postgresql", "mysql", "mongodb", "redis", "sql"]),
      cloud: hasAny(tech, ["aws", "azure", "gcp", "docker", "kubernetes", "devops"]),
      all: tech,
    },
    soft_skills: {
      leadership: hasAny(soft, ["leadership", "management", "team"]),
      communication: hasAny(soft, ["communication", "presentation", "writing"]),
      all: soft,
    },
    tools_technologies: {
      development: hasAny(tools, ["vscode", "intellij", "eclipse", "git", "github", "gitlab"]),
      design: hasAny(tools, ["adobe", "photoshop", "illustrator", "figma", "canva"]),
      productivity: hasAny(tools, ["jira", "confluence", "trello", "slack", "teams"]),
      all: tools,
    },
    certifications_licenses: arr(parsed?.certifications).map((c: Obj) => ({
      name: c.name || "",
      issuingOrganization: c.issuingOrganization || "",
      dateIssued: c.dateIssued || "",
      expirationDate: c.expirationDate || "",
      credentialId: c.credentialId || "",
      credentialUrl: c.credentialUrl || "",
    })),
    awards_honors: arr(parsed?.awards).map((a: Obj) => ({
      title: a.title || "",
      issuer: a.issuer || "",
      date: a.date || "",
      description: a.description || "",
      significance: a.significance || "",
    })),
    projects: arr(parsed?.projects).map((p: Obj) => ({
      name: p.name || "",
      description: p.description || "",
      technologies: Array.isArray(p.technologies) ? p.technologies : [],
      role: p.role || "",
      duration: p.duration || "",
      url: p.url || "",
      repository: p.repository || "",
      impact: p.impact || "",
      metrics: p.metrics || [],
    })),
    languages: arr(parsed?.languages).map((l: any) =>
      typeof l === "string"
        ? { language: l, proficiency: "" }
        : { language: l.language || l.name || "", proficiency: l.proficiency || l.level || "" }
    ),
    volunteer_experience: arr(parsed?.volunteer).map((v: Obj) => ({
      organization: v.organization || "",
      role: v.role || "",
      location: v.location || "",
      startDate: v.startDate || "",
      endDate: v.endDate || "",
      description: v.description || "",
      impact: v.impact || "",
    })),
  };

  const completeness = computeCompleteness({
    // Score the real parsed name, not the "Unknown User" placeholder stored for display.
    personalDetails: { ...row.personal_details, full_name: name.full_name, fullName: name.full_name },
    workExperience: row.work_experience,
    educationHistory: row.education_history,
    technicalSkills: row.technical_skills,
    screeningAnswers: opts.screeningAnswers,
  });

  return { row: { ...row, completeness }, completeness };
}
