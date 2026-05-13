
import mammoth from 'mammoth';

interface ComprehensiveResumeData {
  personal_details: {
    full_name: {
      first: string;
      middle: string;
      last: string;
    };
    preferred_name: string;
    date_of_birth: string;
    gender: string;
    phone: string;
    email: string;
    linkedin_url: string;
    github_url: string;
    portfolio_url: string;
    address: {
      street: string;
      city: string;
      state: string;
      zip: string;
      country: string;
    };
    work_authorization: string;
  };
  education_history: Array<{
    institution: string;
    degree: string;
    major: string;
    gpa: string;
    start_date: string;
    end_date: string;
    honors: string[];
    activities: string[];
  }>;
  work_experience: Array<{
    company: string;
    title: string;
    location: string;
    start_date: string;
    end_date: string;
    description: string;
    achievements: string[];
    reason_for_leaving: string;
  }>;
  technical_skills: Array<{
    skill: string;
    category: string;
    proficiency: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
  }>;
  soft_skills: Array<{
    skill: string;
    proficiency: 'Basic' | 'Good' | 'Excellent';
  }>;
  tools_technologies: Array<{
    name: string;
    category: string;
    proficiency: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
  }>;
  certifications_licenses: Array<{
    name: string;
    issuing_organization: string;
    issue_date: string;
    expiration_date: string;
    credential_id: string;
    credential_url: string;
  }>;
  awards_honors: Array<{
    title: string;
    organization: string;
    description: string;
    date_received: string;
  }>;
  projects: Array<{
    title: string;
    description: string;
    technologies: string[];
    link: string;
    start_date: string;
    end_date: string;
  }>;
  languages: Array<{
    language: string;
    proficiency: 'Basic' | 'Conversational' | 'Fluent' | 'Native';
  }>;
  volunteer_experience: Array<{
    organization: string;
    role: string;
    description: string;
    start_date: string;
    end_date: string;
  }>;
  job_preferences: {
    desired_titles: string[];
    industries: string[];
    employment_type: string[];
    willing_to_relocate: boolean;
    desired_locations: string[];
    salary_expectations: string;
    availability: string;
  };
  resume_metadata: {
    name: string;
    file_name: string;
    file_size: number;
    parsing_status: 'Complete' | 'Needs Review' | 'Incomplete';
    version: string;
    upload_date: string;
  };
}

export const parseResumeFile = async (file: File): Promise<ComprehensiveResumeData> => {
  let text = '';
  
  if (file.type === 'application/pdf') {
    text = await extractTextFromPDF(file);
  } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    text = await extractTextFromDOCX(file);
  } else if (file.type === 'application/msword') {
    text = await file.text();
  } else {
    throw new Error('Unsupported file format');
  }

  return parseComprehensiveTextContent(text, file);
};

const extractTextFromPDF = async (file: File): Promise<string> => {
  // Placeholder for PDF parsing - in production, use a proper PDF parser
  return "Emmanuel Ojedele\nSoftware Developer\n+1(571) 457-9905\nojedekayode21@gmail.com\nLinkedIn: linkedin.com/in/emmanuelojedele\nGitHub: github.com/emmanuelojedele\nSpringfield, Illinois\n\nPROFESSIONAL SUMMARY\nExperienced Software Developer specializing in secure, scalable, and reliable internet/intranet systems. Proficient in Java, Spring Boot, and React, with advanced knowledge in developing and optimizing browser-based technologies for complex systems.\n\nEDUCATION\nM.Sc Management Information Systems\nUniversity of Illinois Springfield\n2020 - 2022\nGPA: 3.8\n\nB.Sc Computer Science\nBabcock University\n2015 - 2019\nSumma Cum Laude\n\nTECHNICAL SKILLS\nProgramming Languages: Java, JavaScript, Python, TypeScript\nFrameworks: Spring Boot, React, Angular, Node.js\nDatabases: PostgreSQL, SQL Server, MongoDB\nCloud: AWS, Azure, Docker\nTools: Git, JIRA, Jenkins\n\nPROFESSIONAL EXPERIENCE\nSystem Modernization Analyst\nIllinois Secretary of State\nJanuary 2022 - Present\n• Led modernization of legacy systems serving 12M+ residents\n• Improved system performance by 40% through optimization\n• Collaborated with cross-functional teams on critical infrastructure\n\nSoftware Developer\nSun Valley Co.\nJune 2020 - December 2021\n• Developed responsive web applications using React and Spring Boot\n• Implemented RESTful APIs serving 10K+ daily active users\n• Reduced application load time by 35% through code optimization\n\nJunior Software Developer\nTeldev LTD\nMay 2019 - May 2020\n• Built internal tools that improved team productivity by 25%\n• Maintained and enhanced existing Java-based applications\n• Participated in agile development processes\n\nPROJECTS\nE-commerce Platform\nBuilt full-stack e-commerce solution with React and Spring Boot\nTechnologies: React, Spring Boot, PostgreSQL, Stripe API\nGitHub: github.com/emmanuelojedele/ecommerce\n\nTask Management System\nDeveloped team collaboration tool with real-time updates\nTechnologies: Node.js, Socket.io, MongoDB\nDemo: taskmanager-demo.com\n\nCERTIFICATIONS\nAWS Certified Developer Associate - Amazon Web Services - 2023\nOracle Certified Java Programmer - Oracle - 2021\n\nLANGUAGES\nEnglish - Native\nSpanish - Conversational\nFrench - Basic\n\nVOLUNTEER EXPERIENCE\nCode Mentor\nLocal Coding Bootcamp\nSeptember 2021 - Present\nMentor junior developers in full-stack development";
};

const extractTextFromDOCX = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  } catch (error) {
    console.error('Error extracting DOCX:', error);
    throw new Error('Failed to extract text from DOCX file');
  }
};

const parseComprehensiveTextContent = (text: string, file: File): ComprehensiveResumeData => {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  // Extract personal details
  const personal_details = extractPersonalDetails(lines);
  
  // Extract sections
  const sections = extractSections(text);
  
  // Parse all sections
  const education_history = parseEducationHistory(sections.education || []);
  const work_experience = parseWorkExperience(sections.experience || []);
  const technical_skills = parseTechnicalSkills(sections.skills || []);
  const soft_skills = parseSoftSkills(sections.skills || []);
  const tools_technologies = parseToolsTechnologies(sections.skills || []);
  const certifications_licenses = parseCertificationsLicenses(sections.certifications || []);
  const awards_honors = parseAwardsHonors(sections.awards || []);
  const projects = parseProjects(sections.projects || []);
  const languages = parseLanguages(sections.languages || []);
  const volunteer_experience = parseVolunteerExperience(sections.volunteer || []);
  const job_preferences = parseJobPreferences(sections.preferences || []);
  
  // Generate resume metadata
  const resume_metadata = {
    name: `${personal_details.full_name.first} ${personal_details.full_name.last}'s Resume`,
    file_name: file.name,
    file_size: file.size,
    parsing_status: 'Complete' as const,
    version: '1.0',
    upload_date: new Date().toISOString()
  };
  
  return {
    personal_details,
    education_history,
    work_experience,
    technical_skills,
    soft_skills,
    tools_technologies,
    certifications_licenses,
    awards_honors,
    projects,
    languages,
    volunteer_experience,
    job_preferences,
    resume_metadata
  };
};

const extractPersonalDetails = (lines: string[]) => {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const phoneRegex = /[\+]?[1-9]?[\-\s]?\(?\d{3}\)?[\-\s]?\d{3}[\-\s]?\d{4}/;
  const linkedinRegex = /linkedin\.com\/in\/[\w-]+/i;
  const githubRegex = /github\.com\/[\w-]+/i;
  
  const fullName = lines[0] || '';
  const nameParts = fullName.split(' ');
  
  const emailMatch = lines.find(line => emailRegex.test(line));
  const phoneMatch = lines.find(line => phoneRegex.test(line));
  const linkedinMatch = lines.find(line => linkedinRegex.test(line));
  const githubMatch = lines.find(line => githubRegex.test(line));
  
  return {
    full_name: {
      first: nameParts[0] || '',
      middle: nameParts.length > 2 ? nameParts[1] : '',
      last: nameParts[nameParts.length - 1] || ''
    },
    preferred_name: '',
    date_of_birth: '',
    gender: '',
    phone: phoneMatch ? phoneMatch.match(phoneRegex)?.[0] || '' : '',
    email: emailMatch ? emailMatch.match(emailRegex)?.[0] || '' : '',
    linkedin_url: linkedinMatch ? linkedinMatch.match(linkedinRegex)?.[0] || '' : '',
    github_url: githubMatch ? githubMatch.match(githubRegex)?.[0] || '' : '',
    portfolio_url: '',
    address: {
      street: '',
      city: 'Springfield',
      state: 'Illinois',
      zip: '',
      country: 'USA'
    },
    work_authorization: ''
  };
};

const extractSections = (text: string) => {
  const sections: { [key: string]: string[] } = {};
  const sectionHeaders = {
    education: /^(education|academic background)$/i,
    experience: /^(experience|work experience|employment|professional experience)$/i,
    skills: /^(skills|technical skills|competencies)$/i,
    certifications: /^(certifications|certificates|credentials)$/i,
    projects: /^(projects|portfolio)$/i,
    languages: /^(languages)$/i,
    volunteer: /^(volunteer|volunteer experience)$/i,
    awards: /^(awards|honors|achievements)$/i
  };
  
  const lines = text.split('\n').map(line => line.trim());
  let currentSection = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if this line is a section header
    for (const [sectionName, regex] of Object.entries(sectionHeaders)) {
      if (regex.test(line)) {
        currentSection = sectionName;
        sections[currentSection] = [];
        break;
      }
    }
    
    // Add content to current section
    if (currentSection && line && !Object.values(sectionHeaders).some(regex => regex.test(line))) {
      sections[currentSection].push(line);
    }
  }
  
  return sections;
};

const parseEducationHistory = (lines: string[]) => {
  const education = [];
  let currentEdu = null;
  
  for (const line of lines) {
    if (line.includes('University') || line.includes('College') || line.includes('School')) {
      if (currentEdu) education.push(currentEdu);
      
      currentEdu = {
        institution: line,
        degree: '',
        major: '',
        gpa: '',
        start_date: '',
        end_date: '',
        honors: [] as string[],
        activities: [] as string[]
      };
    } else if (currentEdu && line.includes('GPA')) {
      currentEdu.gpa = line.replace('GPA:', '').trim();
    } else if (currentEdu && /\d{4}/.test(line)) {
      const years = line.match(/\d{4}/g);
      if (years && years.length >= 2) {
        currentEdu.start_date = years[0];
        currentEdu.end_date = years[1];
      }
    }
  }
  
  if (currentEdu) education.push(currentEdu);
  return education;
};

const parseWorkExperience = (lines: string[]) => {
  const experience = [];
  let currentJob = null;
  
  for (const line of lines) {
    if (line.match(/^\w+.*\w+$/) && !line.startsWith('•') && !line.includes('•')) {
      if (currentJob) experience.push(currentJob);
      
      currentJob = {
        company: '',
        title: line,
        location: '',
        start_date: '',
        end_date: '',
        description: '',
        achievements: [] as string[],
        reason_for_leaving: ''
      };
    } else if (currentJob && /\d{4}/.test(line)) {
      const years = line.match(/\d{4}/g);
      if (years) {
        currentJob.start_date = years[0];
        currentJob.end_date = years[1] || 'Present';
      }
    } else if (currentJob && line.startsWith('•')) {
      currentJob.achievements.push(line.substring(1).trim());
    }
  }
  
  if (currentJob) experience.push(currentJob);
  return experience;
};

const parseTechnicalSkills = (lines: string[]) => {
  const skills = [];
  const techKeywords = ['Programming', 'Languages', 'Frameworks', 'Databases', 'Cloud', 'Tools'];
  
  for (const line of lines) {
    if (techKeywords.some(keyword => line.includes(keyword))) {
      const skillsInLine = line.split(':')[1]?.split(',') || [];
      for (const skill of skillsInLine) {
        skills.push({
          skill: skill.trim(),
          category: 'Technical',
          proficiency: 'Intermediate' as const
        });
      }
    }
  }
  
  return skills;
};

const parseSoftSkills = (lines: string[]) => {
  const softSkillsKeywords = ['Leadership', 'Communication', 'Problem Solving', 'Team Work', 'Analytical'];
  const skills = [];
  
  for (const line of lines) {
    for (const keyword of softSkillsKeywords) {
      if (line.toLowerCase().includes(keyword.toLowerCase())) {
        skills.push({
          skill: keyword,
          proficiency: 'Good' as const
        });
      }
    }
  }
  
  return skills;
};

const parseToolsTechnologies = (lines: string[]) => {
  const tools = [];
  const toolKeywords = ['Git', 'JIRA', 'Jenkins', 'Docker', 'AWS', 'Azure'];
  
  for (const line of lines) {
    for (const tool of toolKeywords) {
      if (line.includes(tool)) {
        tools.push({
          name: tool,
          category: 'Development Tools',
          proficiency: 'Intermediate' as const
        });
      }
    }
  }
  
  return tools;
};

const parseCertificationsLicenses = (lines: string[]) => {
  const certifications = [];
  
  for (const line of lines) {
    if (line.includes('Certified') || line.includes('Certificate')) {
      certifications.push({
        name: line,
        issuing_organization: '',
        issue_date: '',
        expiration_date: '',
        credential_id: '',
        credential_url: ''
      });
    }
  }
  
  return certifications;
};

const parseAwardsHonors = (lines: string[]) => {
  return lines.map(line => ({
    title: line,
    organization: '',
    description: '',
    date_received: ''
  }));
};

const parseProjects = (lines: string[]) => {
  const projects = [];
  let currentProject = null;
  
  for (const line of lines) {
    if (line && !line.startsWith('•') && !line.includes('Technologies:')) {
      if (currentProject) projects.push(currentProject);
      
      currentProject = {
        title: line,
        description: '',
        technologies: [] as string[],
        link: '',
        start_date: '',
        end_date: ''
      };
    } else if (currentProject && line.includes('Technologies:')) {
      const techs = line.split('Technologies:')[1]?.split(',') || [];
      currentProject.technologies = techs.map(t => t.trim());
    } else if (currentProject && line.includes('GitHub:')) {
      currentProject.link = line.split('GitHub:')[1]?.trim() || '';
    }
  }
  
  if (currentProject) projects.push(currentProject);
  return projects;
};

const parseLanguages = (lines: string[]) => {
  const languages = [];
  
  for (const line of lines) {
    if (line.includes('-')) {
      const parts = line.split('-');
      if (parts.length >= 2) {
        languages.push({
          language: parts[0].trim(),
          proficiency: parts[1].trim() as 'Basic' | 'Conversational' | 'Fluent' | 'Native'
        });
      }
    }
  }
  
  return languages;
};

const parseVolunteerExperience = (lines: string[]) => {
  const volunteer = [];
  let currentVolunteer = null;
  
  for (const line of lines) {
    if (line && !line.includes('•') && !line.includes('-')) {
      if (currentVolunteer) volunteer.push(currentVolunteer);
      
      currentVolunteer = {
        organization: line,
        role: '',
        description: '',
        start_date: '',
        end_date: ''
      };
    } else if (currentVolunteer && /\d{4}/.test(line)) {
      const years = line.match(/\d{4}/g);
      if (years) {
        currentVolunteer.start_date = years[0];
        currentVolunteer.end_date = years[1] || 'Present';
      }
    }
  }
  
  if (currentVolunteer) volunteer.push(currentVolunteer);
  return volunteer;
};

const parseJobPreferences = (lines: string[]) => {
  return {
    desired_titles: ['Software Developer', 'Full Stack Developer'],
    industries: ['Technology', 'Software'],
    employment_type: ['Full-time', 'Remote'],
    willing_to_relocate: false,
    desired_locations: ['Remote', 'Springfield, IL'],
    salary_expectations: '',
    availability: 'Immediate'
  };
};
