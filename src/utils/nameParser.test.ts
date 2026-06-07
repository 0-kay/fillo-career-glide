import { parseFullName, combineNameParts, extractNameFromResume } from './nameParser';

// Test cases for name parsing
console.log('=== NAME PARSING TESTS ===');

// Test 1: Single name
const test1 = parseFullName('John');
console.log('Test 1 - Single name:', test1);
// Expected: { first_name: 'John', middle_name: null, last_name: '', full_name: 'John' }

// Test 2: First and last name
const test2 = parseFullName('John Doe');
console.log('Test 2 - First and last:', test2);
// Expected: { first_name: 'John', middle_name: null, last_name: 'Doe', full_name: 'John Doe' }

// Test 3: First, middle, and last name
const test3 = parseFullName('John Michael Doe');
console.log('Test 3 - First, middle, last:', test3);
// Expected: { first_name: 'John', middle_name: 'Michael', last_name: 'Doe', full_name: 'John Michael Doe' }

// Test 4: Multiple middle names
const test4 = parseFullName('John Michael Andrew Doe');
console.log('Test 4 - Multiple middle names:', test4);
// Expected: { first_name: 'John', middle_name: 'Michael Andrew', last_name: 'Doe', full_name: 'John Michael Andrew Doe' }

// Test 5: Name with extra spaces
const test5 = parseFullName('  John   Michael   Doe  ');
console.log('Test 5 - Extra spaces:', test5);
// Expected: { first_name: 'John', middle_name: 'Michael', last_name: 'Doe', full_name: 'John Michael Doe' }

// Test 6: Empty string
const test6 = parseFullName('');
console.log('Test 6 - Empty string:', test6);
// Expected: { first_name: '', middle_name: null, last_name: '', full_name: '' }

// Test 7: Null/undefined
const test7 = parseFullName(null as any);
console.log('Test 7 - Null input:', test7);
// Expected: { first_name: '', middle_name: null, last_name: '', full_name: '' }

console.log('\n=== COMBINE NAME PARTS TESTS ===');

// Test combining name parts
const combined1 = combineNameParts('John', null, 'Doe');
console.log('Combine 1 - No middle:', combined1);
// Expected: 'John Doe'

const combined2 = combineNameParts('John', 'Michael', 'Doe');
console.log('Combine 2 - With middle:', combined2);
// Expected: 'John Michael Doe'

const combined3 = combineNameParts('John', '', 'Doe');
console.log('Combine 3 - Empty middle:', combined3);
// Expected: 'John Doe'

console.log('\n=== EXTRACT FROM RESUME TESTS ===');

// Test extracting from resume data
const resumeData1 = {
  personalInfo: {
    fullName: 'Jane Elizabeth Smith'
  }
};
const extracted1 = extractNameFromResume(resumeData1);
console.log('Extract 1 - From personalInfo:', extracted1);

const resumeData2 = {
  personal_details: {
    name: 'Robert J. Johnson'
  }
};
const extracted2 = extractNameFromResume(resumeData2);
console.log('Extract 2 - From personal_details:', extracted2);

const resumeData3 = {
  name: 'Maria Santos'
};
const extracted3 = extractNameFromResume(resumeData3);
console.log('Extract 3 - From root name:', extracted3);

const resumeData4 = {};
const extracted4 = extractNameFromResume(resumeData4);
console.log('Extract 4 - No name found:', extracted4);

console.log('\n=== REAL WORLD EXAMPLES ===');

// Real world examples
const realNames = [
  'Dr. John Smith',
  'Mary-Jane Watson',
  'José María García',
  '李小明',
  'Muhammad ibn Abdullah',
  'Jean-Claude Van Damme',
  'Catherine Zeta-Jones',
  'J.R.R. Tolkien'
];

realNames.forEach((name, index) => {
  const parsed = parseFullName(name);
  console.log(`Real ${index + 1} - "${name}":`, parsed);
});

export {}; // Make this a module 