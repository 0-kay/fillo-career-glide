/**
 * Name parsing utility functions
 */

export interface ParsedName {
  first_name: string;
  middle_name: string | null;
  last_name: string;
  full_name: string;
}

/**
 * Parse a full name into first, middle, and last name components
 * @param fullName - The full name string to parse
 * @returns ParsedName object with separated components
 */
export function parseFullName(fullName: string): ParsedName {
  if (!fullName || typeof fullName !== 'string') {
    return {
      first_name: '',
      middle_name: null,
      last_name: '',
      full_name: fullName || ''
    };
  }

  // Clean and normalize the name
  const cleanName = fullName.trim().replace(/\s+/g, ' ');
  const nameParts = cleanName.split(' ').filter(part => part.length > 0);

  if (nameParts.length === 0) {
    return {
      first_name: '',
      middle_name: null,
      last_name: '',
      full_name: fullName
    };
  }

  let first_name = '';
  let middle_name: string | null = null;
  let last_name = '';

  if (nameParts.length === 1) {
    // Only one name part - treat as first name
    first_name = nameParts[0];
    last_name = '';
  } else if (nameParts.length === 2) {
    // Two parts - first and last
    first_name = nameParts[0];
    last_name = nameParts[1];
  } else if (nameParts.length === 3) {
    // Three parts - first, middle, last
    first_name = nameParts[0];
    middle_name = nameParts[1];
    last_name = nameParts[2];
  } else {
    // More than three parts - first, middle (all middle parts), last
    first_name = nameParts[0];
    middle_name = nameParts.slice(1, -1).join(' ');
    last_name = nameParts[nameParts.length - 1];
  }

  return {
    first_name,
    middle_name,
    last_name,
    full_name: cleanName
  };
}

/**
 * Combine name parts back into a full name
 * @param first_name - First name
 * @param middle_name - Middle name (optional)
 * @param last_name - Last name
 * @returns Combined full name string
 */
export function combineNameParts(
  first_name: string,
  middle_name: string | null,
  last_name: string
): string {
  const parts = [first_name, middle_name, last_name].filter(part => part && part.trim());
  return parts.join(' ');
}

/**
 * Extract name from various resume formats
 * @param resumeData - Parsed resume data
 * @returns ParsedName object
 */
export function extractNameFromResume(resumeData: any): ParsedName {
  // First, try to extract individual name components from OpenAI response
  if (resumeData.personalInfo) {
    const personalInfo = resumeData.personalInfo;
    
    // If we have individual name components, use them directly
    if (personalInfo.firstName || personalInfo.lastName) {
      return {
        first_name: personalInfo.firstName || '',
        middle_name: personalInfo.middleName || null,
        last_name: personalInfo.lastName || '',
        full_name: personalInfo.fullName || combineNameParts(
          personalInfo.firstName || '',
          personalInfo.middleName || null,
          personalInfo.lastName || ''
        )
      };
    }
    
    // If we have fullName but not individual components, parse it
    if (personalInfo.fullName) {
      return parseFullName(personalInfo.fullName);
    }
  }
  
  // Try other possible name fields in the resume data for backwards compatibility
  const possibleNameFields = [
    resumeData.name,
    resumeData.fullName,
    resumeData.full_name,
    resumeData.personalDetails?.name,
    resumeData.personalDetails?.fullName,
    resumeData.personalDetails?.full_name,
    resumeData.personal_details?.name,
    resumeData.personal_details?.fullName,
    resumeData.personal_details?.full_name,
    resumeData.personal_info?.name,
    resumeData.personal_info?.fullName,
    resumeData.personal_info?.full_name
  ];

  // Find the first non-empty name field
  const fullName = possibleNameFields.find(name => name && typeof name === 'string' && name.trim());

  if (!fullName) {
    return {
      first_name: '',
      middle_name: null,
      last_name: '',
      full_name: ''
    };
  }

  return parseFullName(fullName);
} 