/** A profile shaped like the ones this codebase stores, used across the test suite. */
export const profile = {
  first_name: "Amara",
  last_name: "Okonkwo",
  email: "amara.okonkwo@example.com",
  phone: "+1 (415) 555-0142",
  address: {
    street: "1200 Market Street, Apt 8B",
    city: "San Francisco",
    state: "California",
    postal_code: "94102",
    country: "United States",
  },
  linkedin: "https://linkedin.com/in/amaraokonkwo",
  github: "https://github.com/amarao",
  portfolio: "https://amara.dev",
  work_authorization: "Authorized to work in the US for any employer",
  requires_sponsorship: false,
  willing_to_relocate: true,
  desired_salary: 185000,
  education_history: [
    {
      school: "Massachusetts Institute of Technology",
      degree: "Bachelor of Science",
      major: "Computer Science",
      gpa: "3.8",
      graduation_date: "06/2018",
    },
  ],
  work_experience: [
    {
      company: "Stripe",
      job_title: "Senior Software Engineer",
      start_date: "03/2021",
      end_date: "Present",
      description: "Led payments reliability work across the ledger service.",
    },
    {
      company: "Airbnb",
      job_title: "Software Engineer",
      start_date: "07/2018",
      end_date: "02/2021",
      description: "Built host onboarding flows.",
    },
  ],
  skills: ["TypeScript", "Go", "PostgreSQL", "Kubernetes", "React"],
  languages: ["English", "Igbo", "French"],
  certifications: ["AWS Solutions Architect Associate"],
};

/** Form fields as the extension scrapes them from a real application page. */
export const fields = [
  { name: "firstName", id: "first-name", type: "text", label: "First Name", placeholder: "", required: true, maxLength: 50, context: "" },
  { name: "lastName", id: "last-name", type: "text", label: "Last Name", placeholder: "", required: true, maxLength: 50, context: "" },
  { name: "email", id: "email", type: "email", label: "Email Address", placeholder: "you@example.com", required: true, maxLength: null, context: "" },
  { name: "mobile", id: "phone", type: "tel", label: "Mobile Phone Number", placeholder: "", required: false, maxLength: null, context: "" },
  { name: "addressLine1", id: "addr1", type: "text", label: "Street Address", placeholder: "", required: true, maxLength: null, context: "" },
  { name: "city", id: "city", type: "text", label: "City", placeholder: "", required: true, maxLength: null, context: "" },
  { name: "postal", id: "zip", type: "text", label: "Postal Code", placeholder: "", required: true, maxLength: 10, context: "" },
  { name: "linkedinUrl", id: "linkedin", type: "url", label: "LinkedIn Profile", placeholder: "", required: false, maxLength: null, context: "" },
  { name: "currentEmployer", id: "employer", type: "text", label: "Current Employer", placeholder: "", required: false, maxLength: null, context: "" },
  { name: "currentTitle", id: "title", type: "text", label: "Current Job Title", placeholder: "", required: false, maxLength: null, context: "" },
  { name: "school", id: "school", type: "text", label: "University / School", placeholder: "", required: false, maxLength: null, context: "" },
  { name: "gradDate", id: "grad", type: "date", label: "Graduation Date", placeholder: "", required: false, maxLength: null, context: "" },
  { name: "salary", id: "salary", type: "number", label: "Desired Annual Salary (USD)", placeholder: "", required: false, maxLength: null, context: "" },
  { name: "relocate", id: "relocate", type: "checkbox", label: "Are you willing to relocate?", placeholder: "", required: false, maxLength: null, context: "" },
  { name: "password", id: "pw", type: "password", label: "Create a password", placeholder: "", required: true, maxLength: null, context: "" },
  { name: "referralSource", id: "referral", type: "text", label: "How did you hear about this role?", placeholder: "", required: false, maxLength: null, context: "" },
];

/** What a careful human would fill in, used to score the model's selections. */
export const expected: Record<string, string | number | boolean | null> = {
  firstName: "Amara",
  lastName: "Okonkwo",
  email: "amara.okonkwo@example.com",
  mobile: "+1 (415) 555-0142",
  addressLine1: "1200 Market Street, Apt 8B",
  city: "San Francisco",
  postal: "94102",
  linkedinUrl: "https://linkedin.com/in/amaraokonkwo",
  currentEmployer: "Stripe",
  currentTitle: "Senior Software Engineer",
  school: "Massachusetts Institute of Technology",
  gradDate: "2018-06-01",
  salary: 185000,
  relocate: true,
  password: null,
  referralSource: null,
};

export const savedScreeningAnswers = [
  { question: "Are you legally authorized to work in the United States?", answer: "Yes", answerType: "yes_no" as const, keywords: ["authorized", "work authorization"] },
  { question: "Will you now or in the future require visa sponsorship?", answer: "No", answerType: "yes_no" as const, keywords: ["sponsorship", "visa"] },
  { question: "Are you a protected veteran?", answer: "I am not a protected veteran", keywords: ["veteran"] },
  { question: "Do you have a disability?", answer: "I do not have a disability", keywords: ["disability"] },
  { question: "What is your highest level of education?", answer: "Bachelor's degree", keywords: ["education", "degree"] },
  { question: "What are your salary expectations?", answer: "$185,000", keywords: ["salary", "compensation"] },
  { question: "Are you at least 18 years of age?", answer: "Yes", answerType: "yes_no" as const, keywords: ["18", "age"] },
];

/** Live page questions worded differently from the saved ones, with the index they should map to. */
export const screeningCases: Array<{ text: string; expect: number | null }> = [
  { text: "Do you have the legal right to work in the U.S. without restriction?", expect: 0 },
  { text: "Would you require the company to sponsor an employment visa?", expect: 1 },
  { text: "Please identify whether you are a veteran protected under VEVRAA.", expect: 2 },
  { text: "Voluntary self-identification of disability", expect: 3 },
  { text: "Highest degree completed", expect: 4 },
  { text: "Desired compensation", expect: 5 },
  { text: "Confirm you are 18 years or older", expect: 6 },
  { text: "Please describe a time you resolved a conflict on your team.", expect: null },
  { text: "What is your favourite programming language?", expect: null },
];
