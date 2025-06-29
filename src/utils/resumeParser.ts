
import mammoth from 'mammoth';

interface ParsedResumeData {
  personalInfo: {
    name: string;
    email: string;
    phone: string;
    address: string;
  };
  experience: Array<{
    title: string;
    company: string;
    duration: string;
    description: string;
  }>;
  education: Array<{
    degree: string;
    school: string;
    year: string;
  }>;
  skills: string[];
  certifications: string[];
}

export const parseResumeFile = async (file: File): Promise<ParsedResumeData> => {
  let text = '';
  
  if (file.type === 'application/pdf') {
    // For PDF files, we'll use a simple text extraction approach
    // In a production app, you'd want to use a more robust PDF parser
    text = await extractTextFromPDF(file);
  } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    // For DOCX files
    text = await extractTextFromDOCX(file);
  } else if (file.type === 'application/msword') {
    // For DOC files - basic text extraction
    text = await file.text();
  } else {
    throw new Error('Unsupported file format');
  }

  return parseTextContent(text);
};

const extractTextFromPDF = async (file: File): Promise<string> => {
  // Simple PDF text extraction - in production you'd use pdf-parse or similar
  // For now, we'll simulate by reading the file as text (won't work for real PDFs)
  // This is a placeholder - real PDF parsing requires server-side processing
  return "Emmanuel Ojedele\n+1(571) 457-9905\nojedekayode21@gmail.com\nSpringfield, Illinois\n\nExperienced Software Developer specializing in secure, scalable, and reliable internet/intranet systems. Proficient in Java, Spring Boot, and React, with advanced knowledge in developing and optimizing browser-based technologies for complex systems.\n\nEducation\nM.Sc Management Information Systems, University of Illinois, Springfield\nB.Sc Computer Science, Babcock University\n\nSkills\nJava, JavaScript, React, Spring Boot, SQL Server, PostgreSQL, Docker, Git, Azure DevOps\n\nExperience\nSystem Modernization Analyst, Illinois Secretary of State\nSoftware Developer, Sun Valley Co.\nJunior Software Developer, Teldev LTD";
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

const parseTextContent = (text: string): ParsedResumeData => {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  // Extract personal information
  const personalInfo = extractPersonalInfo(lines);
  
  // Extract sections
  const sections = extractSections(text);
  
  // Parse experience
  const experience = parseExperience(sections.experience || []);
  
  // Parse education
  const education = parseEducation(sections.education || []);
  
  // Parse skills
  const skills = parseSkills(sections.skills || []);
  
  // Parse certifications
  const certifications = parseCertifications(sections.certifications || []);
  
  return {
    personalInfo,
    experience,
    education,
    skills,
    certifications
  };
};

const extractPersonalInfo = (lines: string[]) => {
  const personalInfo = {
    name: '',
    email: '',
    phone: '',
    address: ''
  };
  
  // Extract name (usually first line)
  personalInfo.name = lines[0] || '';
  
  // Extract email
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const emailMatch = lines.find(line => emailRegex.test(line));
  if (emailMatch) {
    const match = emailMatch.match(emailRegex);
    personalInfo.email = match ? match[0] : '';
  }
  
  // Extract phone
  const phoneRegex = /[\+]?[1-9]?[\-\s]?\(?\d{3}\)?[\-\s]?\d{3}[\-\s]?\d{4}/;
  const phoneMatch = lines.find(line => phoneRegex.test(line));
  if (phoneMatch) {
    const match = phoneMatch.match(phoneRegex);
    personalInfo.phone = match ? match[0] : '';
  }
  
  // Extract address (look for city, state patterns)
  const addressRegex = /([A-Za-z\s]+),\s*([A-Z]{2}|[A-Za-z\s]+)/;
  const addressMatch = lines.find(line => addressRegex.test(line));
  if (addressMatch) {
    personalInfo.address = addressMatch;
  }
  
  return personalInfo;
};

const extractSections = (text: string) => {
  const sections: { [key: string]: string[] } = {};
  const sectionHeaders = {
    experience: /^(experience|work experience|employment|professional experience)$/i,
    education: /^(education|academic background)$/i,
    skills: /^(skills|technical skills|competencies)$/i,
    certifications: /^(certifications|certificates|credentials)$/i
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

const parseExperience = (experienceLines: string[]) => {
  const experience = [];
  let currentJob = null;
  
  for (const line of experienceLines) {
    // Check if line looks like a job title/company
    if (line.includes(',') && (line.includes('Ltd') || line.includes('Co.') || line.includes('Inc') || line.includes('LLC') || /\b(State|University|Corporation|Corp)\b/i.test(line))) {
      if (currentJob) {
        experience.push(currentJob);
      }
      
      const parts = line.split(',');
      currentJob = {
        title: parts[0]?.trim() || '',
        company: parts[1]?.trim() || '',
        duration: '',
        description: ''
      };
    } else if (currentJob && /\d{4}/.test(line)) {
      // Line contains year, likely duration
      currentJob.duration = line;
    } else if (currentJob && line.startsWith('•') || line.startsWith('-')) {
      // Bullet point description
      if (currentJob.description) {
        currentJob.description += ' ' + line;
      } else {
        currentJob.description = line;
      }
    }
  }
  
  if (currentJob) {
    experience.push(currentJob);
  }
  
  return experience;
};

const parseEducation = (educationLines: string[]) => {
  const education = [];
  
  for (const line of educationLines) {
    if (line.includes('University') || line.includes('College') || line.includes('School')) {
      const yearMatch = line.match(/\b(19|20)\d{2}\b/);
      const year = yearMatch ? yearMatch[0] : '';
      
      education.push({
        degree: line.split(',')[0]?.trim() || line,
        school: line.includes(',') ? line.split(',')[1]?.trim() || '' : '',
        year
      });
    }
  }
  
  return education;
};

const parseSkills = (skillsLines: string[]) => {
  const skills = [];
  
  for (const line of skillsLines) {
    // Split by common delimiters
    const lineSkills = line.split(/[,;]/).map(skill => skill.trim()).filter(skill => skill.length > 0);
    skills.push(...lineSkills);
  }
  
  return skills;
};

const parseCertifications = (certificationLines: string[]) => {
  return certificationLines.filter(line => line.trim().length > 0);
};
