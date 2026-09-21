import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const MATCH_CONFIG = {
  "domains": {
    "*.myworkdayjobs.com": {
      "platform": "workday",
      "fields": [
        {
          "name": "legalName--firstName",
          "label": "Given Name",
          "type": "text",
          "required": true,
          "profilePath": "first_name"
        },
        {
          "name": "legalName--middleName",
          "label": "Middle Name",
          "type": "text",
          "required": false,
          "profilePath": "middle_name"
        },
        {
          "name": "legalName--lastName",
          "label": "Family Name",
          "type": "text",
          "required": true,
          "profilePath": "last_name"
        },
        {
          "name": "name",
          "label": "Name",
          "type": "text",
          "required": true,
          "profilePath": "personal_details.fullName"
        },
        {
          "name": "country",
          "label": "Country",
          "type": "dropdown",
          "required": true,
          "profilePath": "personal_details.address.country",
          "selector": "[data-automation-id='formField-country'] button[aria-haspopup='listbox'], [data-automation-id='formField-country'] [role='combobox'], [data-automation-id='formField-country'] input"
        },
        {
          "name": "addressLine1",
          "label": "Address Line 1",
          "type": "text",
          "profilePath": "personal_details.address.line1"
        },
        {
          "name": "city",
          "label": "City",
          "type": "text",
          "profilePath": "personal_details.address.city"
        },
        {
          "name": "postalCode",
          "label": "Postal Code",
          "type": "text",
          "profilePath": "personal_details.address.postalCode"
        },
        {
          "name": "countryRegion",
          "label": "State",
          "type": "dropdown",
          "profilePath": "personal_details.address.state",
          "selector": "[data-automation-id='formField-countryRegion'] button[aria-haspopup='listbox'], [data-automation-id='formField-countryRegion'] [role='combobox'], [data-automation-id='formField-countryRegion'] input"
        },
        {
          "name": "regionSubdivision1",
          "label": "Country",
          "type": "text",
          "required": true,
          "profilePath": "personal_details.address.country"
        },
        {
          "name": "countryPhoneCode",
          "label": "Country / Territory Phone Code",
          "type": "single-select",
          "required": true,
          "profilePath": "personal_details.countryPhoneCode"
        },
        {
          "name": "phoneType",
          "label": "Phone Device Type",
          "type": "dropdown",
          "required": true,
          "profilePath": "personal_details.phoneType",
          "default": "Mobile"
        },
        {
          "name": "phoneNumber",
          "label": "Phone Number",
          "type": "text",
          "required": true,
          "profilePath": "personal_details.phone"
        },
        {
          "name": "extension",
          "label": "Phone Extension",
          "type": "text",
          "profilePath": "personal_details.phoneExtension"
        },
        {
          "name": "skills",
          "label": "Type to Add Skills",
          "type": "multi-select",
          "profilePath": "technical_skills",
          "selector": "[data-automation-id='formField-skillsPrompt'] input, [data-automation-id='formField-skills'] [data-automation-id='multiSelectContainer'] input, [data-fkit-id='skills--skills'] input, input#skills--skills, input[data-uxi-multiselect-id][id$='--skills']"
        },
        {
          "name": "resume",
          "label": "Resume",
          "type": "file",
          "required": false,
          "profilePath": "resume",
          "selector": "input[data-automation-id='file-upload-input-ref'], [data-automation-id='attachments-FileUpload'] input[type='file'], [data-automation-id='resumeUpload'] input[type='file'], [data-automation-id='resumeSection'] input[type='file']"
        },
        {
          "key": "disability_status",
          "name": "disabilityStatus",
          "label": "Please check one of the boxes below:",
          "type": "single_choice",
          "profilePath": "job_preferences.eeo.disability_status",
          "patterns": [
            "disability",
            "self identified disability",
            "disability status",
            "ofccp",
            "please check one of the boxes below"
          ],
          "options": [
            "Yes, I have a disability, or have had one in the past",
            "No, I do not have a disability and have not had one in the past",
            "I do not want to answer"
          ],
          "default": "I do not want to answer"
        },
        {
          "key": "date_signed",
          "label": "Date Signed",
          "type": "date",
          "profilePath": "__today",
          "patterns": [
            "date signed",
            "signature date",
            "date",
            "today"
          ]
        },
        {
          "name": "linkedInAccount",
          "label": "LinkedIn",
          "type": "text",
          "profilePath": "personal_details.linkedin"
        },
        {
          "name": "facebookAccount",
          "label": "Facebook",
          "type": "text",
          "profilePath": "personal_details.facebook"
        },
        {
          "name": "twitterAccount",
          "label": "Twitter",
          "type": "text",
          "profilePath": "personal_details.twitter"
        }
      ],
      "arrays": {
        "work_experience": {
          "sectionType": "work",
          "fields": [
            {
              "name": "companyName",
              "label": "Company",
              "type": "text",
              "key": "company"
            },
            {
              "name": "jobTitle",
              "label": "Job Title",
              "type": "text",
              "key": "jobTitle"
            },
            {
              "name": "startDate",
              "label": "Start Date",
              "type": "text",
              "key": "startDate"
            },
            {
              "name": "endDate",
              "label": "End Date",
              "type": "text",
              "key": "endDate"
            },
            {
              "name": "location",
              "label": "Location",
              "type": "text",
              "key": "location"
            },
            {
              "name": "roleDescription",
              "label": "Description",
              "type": "textarea",
              "key": "description"
            }
          ]
        },
        "education_history": {
          "sectionType": "education",
          "fields": [
            {
              "name": "school",
              "label": "School",
              "type": "single-select",
              "key": "school",
              "selector": "[data-automation-id='formField-schoolItem'] input, [data-automation-id='formField-school'] input, [data-automation-id='formField-schoolName'] input"
            },
            {
              "name": "schoolName",
              "label": "School or University",
              "type": "single-select",
              "key": "school",
              "selector": "[data-automation-id='formField-schoolItem'] input, [data-automation-id='formField-schoolName'] input, [data-automation-id='formField-school'] input"
            },
            {
              "name": "degree",
              "label": "Degree",
              "type": "dropdown",
              "key": "degree",
              "selector": "button[data-automation-id='degree'], [data-automation-id='formField-degree'] button, [data-automation-id='formField-degree'] input"
            },
            {
              "name": "fieldOfStudy",
              "label": "Field of Study",
              "type": "single-select",
              "key": "fieldOfStudy",
              "selector": "[data-automation-id='formField-field-of-study'] input, [data-automation-id='formField-fieldOfStudy'] input"
            },
            {
              "name": "educationStartDate",
              "label": "From",
              "type": "text",
              "key": "startDate"
            },
            {
              "name": "educationEndDate",
              "label": "To (Actual or Expected)",
              "type": "text",
              "key": "endDate"
            },
            {
              "name": "gradeAverage",
              "label": "Overall Result (GPA)",
              "type": "text",
              "key": "gpa",
              "selector": "input[data-automation-id='gpa'], [data-automation-id='formField-gradeAverage'] input"
            },
            {
              "name": "firstYearAttended",
              "label": "From",
              "type": "text",
              "key": "startDate",
              "selector": "[data-automation-id='formField-firstYearAttended'] input",
              "selectorAttr": "aria-describedby",
              "selectorMatch": "contains"
            },
            {
              "name": "lastYearAttended",
              "label": "To (Actual or Expected)",
              "type": "text",
              "key": "endDate",
              "selector": "[data-automation-id='formField-lastYearAttended'] input",
              "selectorAttr": "aria-describedby",
              "selectorMatch": "contains"
            }
          ]
        },
        "websites": {
          "sectionType": "websites",
          "fields": [
            {
              "name": "websiteAddress",
              "label": "Web Address",
              "type": "text",
              "selector": "[data-automation-id='formField-url'] input[name='url'], [data-automation-id='formField-url'] input[id$='--url'], input[name='url'][id*='webAddress-']",
              "key": "url"
            }
          ]
        }
      },
      "screeningQuestions": [
        {
          "pattern": "authorized to work",
          "key": "work_authorization",
          "answerType": "yes_no"
        },
        {
          "pattern": "visa sponsorship",
          "key": "visa_sponsorship",
          "answerType": "yes_no"
        },
        {
          "pattern": "require sponsorship",
          "key": "visa_sponsorship",
          "answerType": "yes_no"
        },
        {
          "pattern": "relocat",
          "key": "relocation",
          "answerType": "yes_no"
        },
        {
          "pattern": "non-compete",
          "key": "non_compete",
          "answerType": "yes_no"
        },
        {
          "pattern": "non-solicitation",
          "key": "non_compete",
          "answerType": "yes_no"
        },
        {
          "pattern": "government employee",
          "key": "government_employee",
          "answerType": "yes_no"
        },
        {
          "pattern": "sanctioned",
          "key": "sanctioned_country",
          "answerType": "yes_no"
        },
        {
          "pattern": "export control",
          "key": "sanctioned_country",
          "answerType": "yes_no"
        },
        {
          "pattern": "citizenship",
          "key": "additional_citizenship",
          "answerType": "yes_no"
        },
        {
          "pattern": "permanent residen",
          "key": "additional_citizenship",
          "answerType": "yes_no"
        },
        {
          "pattern": "related to a current",
          "key": "related_employee",
          "answerType": "yes_no"
        },
        {
          "pattern": "related to an employee",
          "key": "related_employee",
          "answerType": "yes_no"
        },
        {
          "pattern": "employed by this company",
          "key": "prior_employment",
          "answerType": "yes_no"
        },
        {
          "pattern": "worked for this company",
          "key": "prior_employment",
          "answerType": "yes_no"
        },
        {
          "pattern": "worked for",
          "key": "prior_employment",
          "answerType": "yes_no"
        },
        {
          "pattern": "subsidiaries",
          "key": "prior_employment",
          "answerType": "yes_no"
        },
        {
          "pattern": "as a contractor",
          "key": "current_contractor",
          "answerType": "yes_no"
        },
        {
          "pattern": "vendor, or temporary",
          "key": "current_contractor",
          "answerType": "yes_no"
        },
        {
          "pattern": "18 years",
          "key": "age_requirement",
          "answerType": "yes_no"
        },
        {
          "pattern": "background check",
          "key": "background_check",
          "answerType": "yes_no"
        },
        {
          "pattern": "acknowledge",
          "key": "acknowledgment",
          "answerType": "yes_no"
        },
        {
          "pattern": "truthful",
          "key": "acknowledgment",
          "answerType": "yes_no"
        },
        {
          "pattern": "salary",
          "key": "salary_expectations",
          "answerType": "text"
        },
        {
          "pattern": "expected salary",
          "key": "salary_expectations",
          "answerType": "text"
        },
        {
          "pattern": "compensation",
          "key": "salary_expectations",
          "answerType": "text"
        },
        {
          "pattern": "expected compensation",
          "key": "salary_expectations",
          "answerType": "text"
        },
        {
          "pattern": "how did you hear",
          "key": "referral_source",
          "answerType": "text"
        },
        {
          "pattern": "highest level of education",
          "key": "education_level",
          "answerType": "text"
        },
        {
          "pattern": "please check one of the boxes below",
          "key": "disability_status",
          "answerType": "text",
          "options": [
            "Yes, I have a disability, or have had one in the past",
            "No, I do not have a disability and have not had one in the past",
            "I do not want to answer"
          ]
        },
        {
          "pattern": "disability status",
          "key": "disability_status",
          "answerType": "text",
          "options": [
            "Yes, I have a disability, or have had one in the past",
            "No, I do not have a disability and have not had one in the past",
            "I do not want to answer"
          ]
        },
        {
          "pattern": "self identified disability",
          "key": "disability_status",
          "answerType": "text",
          "options": [
            "Yes, I have a disability, or have had one in the past",
            "No, I do not have a disability and have not had one in the past",
            "I do not want to answer"
          ]
        }
      ]
    },
    "*.icims.com": {
      "platform": "icims",
      "fields": [
        {
          "name": "PersonProfileFields.FirstName",
          "label": "First Name",
          "type": "text",
          "required": true,
          "profilePath": "first_name"
        },
        {
          "name": "PersonProfileFields.LastName",
          "label": "Last Name",
          "type": "text",
          "required": true,
          "profilePath": "last_name"
        },
        {
          "name": "PersonProfileFields.Email",
          "label": "Email",
          "type": "email",
          "required": true,
          "profilePath": "personal_details.email"
        },
        {
          "name": "PersonProfileFields.PersonalEmail",
          "label": "Personal Email",
          "type": "email",
          "required": false,
          "profilePath": "personal_details.email"
        },
        {
          "name": "resume",
          "label": "Resume",
          "type": "file",
          "required": false,
          "profilePath": "resume",
          "selector": "input[type='file'][name*='resume'], input[type='file'][id*='resume'], input[type='file'][name*='Resume'], input[type='file'][id*='Resume'], [id*='resume'] input[type='file'], [id*='Resume'] input[type='file'], [name*='resume'] input[type='file'], [name*='Resume'] input[type='file'], [data-test*='resume'] input[type='file'], [data-automation-id*='resume'] input[type='file']"
        },
        {
          "name": "-1_PersonProfileFields.PhoneType",
          "label": "Type",
          "type": "dropdown",
          "required": true,
          "profilePath": "personal_details.phoneType",
          "default": "Mobile"
        },
        {
          "name": "-1_PersonProfileFields.PhoneNumber",
          "label": "Number",
          "type": "text",
          "required": true,
          "profilePath": "personal_details.phone"
        },
        {
          "name": "-1_PersonProfileFields.AddressType",
          "label": "Type",
          "type": "dropdown",
          "required": true,
          "profilePath": "personal_details.addressType",
          "default": "Home"
        },
        {
          "name": "-1_PersonProfileFields.AddressStreet1",
          "label": "Address",
          "type": "text",
          "required": true,
          "profilePath": "personal_details.address.line1"
        },
        {
          "name": "-1_PersonProfileFields.AddressStreet2",
          "label": "Address Line 2",
          "type": "text",
          "required": false,
          "profilePath": "personal_details.address.line2"
        },
        {
          "name": "-1_PersonProfileFields.AddressCity",
          "label": "City",
          "type": "text",
          "required": true,
          "profilePath": "personal_details.address.city"
        },
        {
          "name": "-1_PersonProfileFields.AddressZip",
          "label": "Zip/Postal Code",
          "type": "text",
          "required": true,
          "profilePath": "personal_details.address.postalCode"
        },
        {
          "name": "-1_PersonProfileFields.AddressCountry",
          "label": "Country",
          "type": "icims-dropdown",
          "required": false,
          "profilePath": "personal_details.address.country",
          "selectorNote": "Uses icimsdropdown widget with typeahead search"
        },
        {
          "name": "-1_PersonProfileFields.AddressState",
          "label": "State/Province",
          "type": "icims-dropdown",
          "required": false,
          "profilePath": "personal_details.address.state",
          "selectorNote": "Depends on selected country; uses icimsdropdown widget"
        }
      ],
      "arrays": {},
      "screeningQuestions": [
        {
          "pattern": "authorized to work",
          "key": "work_authorization",
          "answerType": "yes_no"
        },
        {
          "pattern": "work lawfully",
          "key": "work_authorization",
          "answerType": "yes_no"
        },
        {
          "pattern": "lawfully in the united states",
          "key": "work_authorization",
          "answerType": "yes_no"
        },
        {
          "pattern": "immigration case",
          "key": "visa_sponsorship",
          "answerType": "yes_no"
        },
        {
          "pattern": "sponsor",
          "key": "visa_sponsorship",
          "answerType": "yes_no"
        },
        {
          "pattern": "sponsorship",
          "key": "visa_sponsorship",
          "answerType": "yes_no"
        },
        {
          "pattern": "employment-based visa",
          "key": "visa_sponsorship",
          "answerType": "yes_no"
        },
        {
          "pattern": "h-1b",
          "key": "visa_sponsorship",
          "answerType": "yes_no"
        },
        {
          "pattern": "protected veteran",
          "key": "protected_veteran",
          "answerType": "text"
        },
        {
          "pattern": "veteran status",
          "key": "protected_veteran",
          "answerType": "text"
        },
        {
          "pattern": "vevraa",
          "key": "protected_veteran",
          "answerType": "text"
        },
        {
          "pattern": "disabled veteran",
          "key": "protected_veteran",
          "answerType": "text"
        },
        {
          "pattern": "icims_f_veteran",
          "key": "protected_veteran",
          "answerType": "text"
        },
        {
          "pattern": "gender",
          "key": "gender",
          "answerType": "text"
        },
        {
          "pattern": "race",
          "key": "race_ethnicity",
          "answerType": "text"
        },
        {
          "pattern": "ethnicity",
          "key": "race_ethnicity",
          "answerType": "text"
        }
      ]
    },
    "*.smartrecruiters.com": {
      "platform": "smartrecruiters",
      "fields": [
        {
          "name": "first-name-input",
          "label": "First name",
          "type": "text",
          "required": true,
          "selector": "spl-input#first-name-input",
          "dataTest": "personal-info-first-name-input",
          "autocomplete": "given-name",
          "profilePath": "first_name"
        },
        {
          "name": "last-name-input",
          "label": "Last name",
          "type": "text",
          "required": true,
          "selector": "spl-input#last-name-input",
          "dataTest": "personal-info-last-name-input",
          "autocomplete": "family-name",
          "profilePath": "last_name"
        },
        {
          "name": "email-input",
          "label": "Email",
          "type": "email",
          "required": true,
          "selector": "spl-input#email-input",
          "dataTest": "personal-info-email-input",
          "autocomplete": "email",
          "profilePath": "personal_details.email"
        },
        {
          "name": "confirm-email-input",
          "label": "Confirm your email",
          "type": "email",
          "required": true,
          "selector": "spl-input#confirm-email-input",
          "dataTest": "personal-info-email-confirm-input",
          "autocomplete": "email",
          "profilePath": "personal_details.email"
        },
        {
          "name": "location",
          "label": "City",
          "type": "text",
          "required": false,
          "selector": "[data-test='piersonal-info-location'] spl-autocomplete",
          "dataTest": "location-autocomplete",
          "dataSrId": "location-autocomplete-search",
          "profilePath": "personal_details.city"
        },
        {
          "name": "phoneNumber",
          "label": "Phone number",
          "type": "text",
          "required": true,
          "selector": "[data-test='personal-info-phone'] spl-phone-field",
          "profilePath": "personal_details.phone"
        },
        {
          "name": "linkedin-input",
          "label": "LinkedIn",
          "type": "text",
          "required": false,
          "selector": "spl-input#linkedin-input",
          "dataTest": "web-profiles-linkedin",
          "profilePath": "personal_details.linkedin"
        },
        {
          "name": "facebook-input",
          "label": "Facebook",
          "type": "text",
          "required": false,
          "selector": "spl-input#facebook-input",
          "dataTest": "web-profiles-facebook",
          "profilePath": "personal_details.facebook"
        },
        {
          "name": "twitter-input",
          "label": "X (fka Twitter)",
          "type": "text",
          "required": false,
          "selector": "spl-input#twitter-input",
          "dataTest": "web-profiles-twitter",
          "profilePath": "personal_details.twitter"
        },
        {
          "name": "website-input",
          "label": "Website",
          "type": "text",
          "required": false,
          "selector": "spl-input#website-input",
          "dataTest": "web-profiles-website",
          "profilePath": "personal_details.website"
        },
        {
          "name": "resume",
          "label": "Resume",
          "type": "file",
          "required": false,
          "dataTest": "resume-upload",
          "maxSize": "10MB",
          "profilePath": "resume"
        },
        {
          "name": "hiring-manager-message-input",
          "label": "Message to the Hiring Team",
          "type": "textarea",
          "required": false,
          "selector": "spl-textarea#hiring-manager-message-input",
          "dataTest": "hiring-manager-message-text",
          "profilePath": "cover_letter"
        }
      ],
      "arrays": {
        "work_experience": {
          "sectionType": "experience",
          "addButtonDataTest": "add-experience",
          "entryDataTest": "experience-entry",
          "saveButtonDataTest": "experience-save",
          "cancelButtonDataTest": "experience-cancel",
          "fields": [
            {
              "name": "title",
              "label": "Title",
              "type": "text",
              "required": true,
              "dataTest": "job-title-autocomplete",
              "selector": "spl-autocomplete[data-test='job-title-autocomplete']",
              "key": "jobTitle"
            },
            {
              "name": "company",
              "label": "Company",
              "type": "text",
              "required": false,
              "dataTest": "company-autocomplete",
              "selector": "spl-autocomplete[data-test='company-autocomplete']",
              "key": "company"
            },
            {
              "name": "description",
              "label": "Description",
              "type": "textarea",
              "required": false,
              "dataTest": "experience-description",
              "selector": "[data-test='experience-description'] spl-textarea",
              "key": "description"
            },
            {
              "name": "startDate",
              "label": "From",
              "type": "text",
              "required": true,
              "dataTest": "experience-date-from",
              "selector": "[data-test='experience-date-from'] spl-date-field",
              "key": "startDate"
            },
            {
              "name": "endDate",
              "label": "To",
              "type": "text",
              "required": true,
              "dataTest": "experience-date-to",
              "selector": "[data-test='experience-date-to'] spl-date-field",
              "key": "endDate"
            },
            {
              "name": "current",
              "label": "I currently work here",
              "type": "checkbox",
              "required": false,
              "dataTest": "experience-current",
              "selector": "[data-test='experience-current'] spl-checkbox",
              "key": "currentlyWorking"
            }
          ]
        },
        "education_history": {
          "sectionType": "education",
          "addButtonDataTest": "add-education",
          "entryDataTest": "education-entry",
          "saveButtonDataTest": "education-save",
          "cancelButtonDataTest": "education-cancel",
          "fields": [
            {
              "name": "institution",
              "label": "Institution",
              "type": "text",
              "required": true,
              "dataTest": "institution-autocomplete",
              "selector": "spl-autocomplete[data-test='institution-autocomplete']",
              "key": "school"
            },
            {
              "name": "major",
              "label": "Major",
              "type": "text",
              "required": false,
              "dataTest": "education-major",
              "selector": "[data-test='education-major'] spl-input",
              "key": "fieldOfStudy"
            },
            {
              "name": "degree",
              "label": "Degree",
              "type": "text",
              "required": false,
              "dataTest": "education-degree",
              "selector": "[data-test='education-degree'] spl-input",
              "key": "degree"
            },
            {
              "name": "description",
              "label": "Description",
              "type": "textarea",
              "required": false,
              "dataTest": "education-description",
              "selector": "[data-test='education-description'] spl-textarea",
              "key": "description"
            },
            {
              "name": "startDate",
              "label": "From",
              "type": "text",
              "required": false,
              "dataTest": "education-date-from",
              "selector": "[data-test='education-date-from'] spl-date-field",
              "key": "startDate"
            },
            {
              "name": "endDate",
              "label": "To",
              "type": "text",
              "required": false,
              "dataTest": "education-date-to",
              "selector": "[data-test='education-date-to'] spl-date-field",
              "key": "endDate"
            },
            {
              "name": "current",
              "label": "I currently attend",
              "type": "checkbox",
              "required": false,
              "dataTest": "education-current",
              "selector": "[data-test='education-current'] spl-checkbox",
              "key": "currentlyAttending"
            }
          ]
        }
      }
    },
    "*.lever.co": {
      "platform": "lever",
      "fields": [
        {
          "name": "name",
          "label": "Full name",
          "type": "text",
          "required": true,
          "profilePath": "personal_details.fullName",
          "selector": "input[name='name']"
        },
        {
          "name": "email",
          "label": "Email",
          "type": "email",
          "required": true,
          "profilePath": "personal_details.email",
          "selector": "input[name='email']"
        },
        {
          "name": "phone",
          "label": "Phone",
          "type": "text",
          "required": true,
          "profilePath": "personal_details.phone",
          "selector": "input[name='phone']"
        },
        {
          "name": "location",
          "label": "Current location",
          "type": "text",
          "profilePath": "personal_details.address.city",
          "selector": "input[name='location']"
        },
        {
          "name": "org",
          "label": "Current company",
          "type": "text",
          "profilePath": "__current_company",
          "selector": "input[name='org']"
        },
        {
          "name": "urls[LinkedIn]",
          "label": "LinkedIn URL",
          "type": "text",
          "profilePath": "personal_details.linkedin",
          "selector": "input[name='urls[LinkedIn]']"
        },
        {
          "name": "urls[Other Website]",
          "label": "Other Website URL",
          "type": "text",
          "profilePath": "personal_details.website",
          "selector": "input[name='urls[Other Website]']"
        },
        {
          "name": "eeo[gender]",
          "label": "Gender",
          "type": "dropdown",
          "profilePath": "job_preferences.eeo.gender",
          "selector": "select[name='eeo[gender]']"
        },
        {
          "name": "eeo[disability]",
          "label": "Disability status",
          "type": "dropdown",
          "profilePath": "job_preferences.eeo.disability_status",
          "selector": "select[name='eeo[disability]']"
        }
      ]
    },
    "*.greenhouse.io": {
      "platform": "greenhouse",
      "fields": [
        {
          "name": "first_name",
          "label": "First Name",
          "type": "text",
          "required": true,
          "profilePath": "first_name",
          "selector": "#first_name"
        },
        {
          "name": "last_name",
          "label": "Last Name",
          "type": "text",
          "required": true,
          "profilePath": "last_name",
          "selector": "#last_name"
        },
        {
          "name": "email",
          "label": "Email",
          "type": "email",
          "required": true,
          "profilePath": "personal_details.email",
          "selector": "#email"
        },
        {
          "name": "phone",
          "label": "Phone",
          "type": "tel",
          "profilePath": "personal_details.phone",
          "selector": "#phone"
        },
        {
          "name": "candidate-location",
          "label": "Location (City)",
          "type": "text",
          "profilePath": "personal_details.address.city",
          "selector": "#candidate-location"
        },
        {
          "name": "country",
          "label": "Country",
          "type": "text",
          "profilePath": "personal_details.address.country",
          "selector": "#country"
        },
        {
          "name": "linkedin_profile",
          "label": "LinkedIn Profile",
          "type": "text",
          "profilePath": "personal_details.linkedin"
        }
      ]
    },
    "*.ashbyhq.com": {
      "platform": "ashby",
      "fields": [
        {
          "name": "_systemfield_name",
          "label": "Name",
          "type": "text",
          "required": true,
          "profilePath": "personal_details.fullName",
          "selector": "#_systemfield_name"
        },
        {
          "name": "_systemfield_email",
          "label": "Email",
          "type": "email",
          "required": true,
          "profilePath": "personal_details.email",
          "selector": "#_systemfield_email"
        },
        {
          "name": "phone",
          "label": "Phone Number",
          "type": "tel",
          "profilePath": "personal_details.phone",
          "selector": "input[type='tel']"
        },
        {
          "name": "linkedin_profile",
          "label": "LinkedIn Profile",
          "type": "text",
          "profilePath": "personal_details.linkedin"
        }
      ]
    }
  },
  "mapping": {
    "name": [
      "name",
      "fullName",
      "FullName",
      "fullname",
      "full_name"
    ],
    "first_name": [
      "first_name",
      "firstName",
      "FirstName",
      "Firstname",
      "firstname",
      "fName",
      "Fname"
    ],
    "middle_name": [
      "middle_name",
      "middleName",
      "MiddleName",
      "Middlename",
      "middlename",
      "mName",
      "Mname"
    ],
    "last_name": [
      "last_name",
      "lastName",
      "LastName",
      "Lastname",
      "lastname",
      "lName",
      "Lname"
    ],
    "personal_details": {
      "fullName": [
        "fullName",
        "FullName",
        "fullname",
        "full_name"
      ],
      "email": [
        "email",
        "emailAddress",
        "Email",
        "EmailAddress",
        "email_address"
      ],
      "phone": [
        "phone",
        "phoneNumber",
        "Phone",
        "PhoneNumber",
        "tel",
        "telephone",
        "telephoneNumber"
      ],
      "phoneExtension": [
        "extension",
        "phoneExtension",
        "phone_extension",
        "ext"
      ],
      "address": {
        "line1": [
          "address",
          "Address",
          "streetAddress",
          "street_address",
          "addr",
          "addressLine1",
          "address_line_1"
        ],
        "line2": [
          "addressLine2",
          "address_line_2",
          "apt",
          "suite",
          "unit"
        ],
        "city": [
          "city",
          "City",
          "municipality"
        ],
        "state": [
          "state",
          "State",
          "province",
          "Province",
          "region",
          "countryRegion"
        ],
        "postalCode": [
          "postalCode",
          "postal_code",
          "PostalCode",
          "zipCode",
          "zip_code",
          "zip"
        ],
        "country": [
          "country",
          "Country",
          "countryCode",
          "country_code"
        ]
      },
      "linkedin": [
        "linkedin",
        "linkedIn",
        "linkedInURL",
        "linkedInUrl",
        "linkedinUrl"
      ],
      "github": [
        "github",
        "gitHub",
        "gitHubURL",
        "gitHubUrl",
        "githubUrl"
      ],
      "portfolio": [
        "portfolio",
        "Portfolio",
        "portfolioURL",
        "portfolioUrl"
      ],
      "summary": [
        "summary",
        "Summary",
        "professionalSummary",
        "professional_summary"
      ],
      "additionalLinks": {
        "label": [
          "label",
          "linkLabel",
          "LinkLabel"
        ],
        "url": [
          "url",
          "link",
          "Link",
          "URL"
        ]
      }
    },
    "technical_skills": [
      "technical_skills",
      "technicalSkills",
      "TechnicalSkills",
      "techSkills",
      "skillsTechnical"
    ],
    "soft_skills": [
      "soft_skills",
      "softSkills",
      "SoftSkills",
      "skillsSoft"
    ],
    "tools_technologies": [
      "tools_technologies",
      "toolsTechnologies",
      "ToolsTechnologies",
      "tools",
      "technologies"
    ],
    "education_history": {
      "degree": [
        "degree",
        "Degree",
        "educationDegree"
      ],
      "school": [
        "school",
        "School",
        "university",
        "University",
        "college",
        "College"
      ],
      "location": [
        "location",
        "Location",
        "institutionLocation"
      ],
      "startDate": [
        "startDate",
        "start_date",
        "StartDate",
        "eduStart"
      ],
      "endDate": [
        "endDate",
        "end_date",
        "EndDate",
        "graduationDate",
        "eduEnd"
      ],
      "description": [
        "description",
        "eduDescription",
        "educationDescription"
      ]
    },
    "work_experience": {
      "jobTitle": [
        "jobTitle",
        "job_title",
        "JobTitle",
        "position",
        "positionTitle"
      ],
      "company": [
        "company",
        "Company",
        "employer",
        "Employer"
      ],
      "location": [
        "location",
        "Location",
        "jobLocation",
        "workLocation"
      ],
      "startDate": [
        "startDate",
        "start_date",
        "StartDate",
        "jobStart"
      ],
      "endDate": [
        "endDate",
        "end_date",
        "EndDate",
        "jobEnd"
      ],
      "description": [
        "description",
        "jobDescription",
        "workDescription",
        "roleDescription"
      ]
    },
    "certifications": {
      "name": [
        "name",
        "certificationName",
        "certificateName",
        "certName"
      ],
      "issuingOrganization": [
        "issuingOrganization",
        "issuer",
        "issuingBody",
        "organizationIssuer"
      ],
      "dateIssued": [
        "dateIssued",
        "issueDate",
        "certificationDate",
        "validThrough"
      ],
      "credentialId": [
        "credentialId",
        "credentialID",
        "certificateId",
        "certId"
      ],
      "expirationDate": [
        "expirationDate",
        "expiryDate",
        "certificationExpiry",
        "expiration"
      ]
    },
    "languages": [
      "languages",
      "language",
      "Languages",
      "spokenLanguages",
      "proficiencyLanguages"
    ],
    "projects": {
      "name": [
        "name",
        "projectName",
        "project_name",
        "ProjectName"
      ],
      "description": [
        "description",
        "projectDescription",
        "details",
        "projectDetails"
      ],
      "technologies": [
        "technologies",
        "techStack",
        "projectTechnologies",
        "stack"
      ],
      "role": [
        "role",
        "projectRole",
        "roleInProject"
      ],
      "duration": [
        "duration",
        "projectDuration",
        "timeframe"
      ],
      "url": [
        "url",
        "projectUrl",
        "link",
        "projectLink"
      ],
      "githubUrl": [
        "githubUrl",
        "projectGithubUrl",
        "repoUrl"
      ],
      "demoUrl": [
        "demoUrl",
        "projectDemoUrl",
        "liveDemoUrl"
      ],
      "links": {
        "label": [
          "label",
          "linkLabel",
          "linkName"
        ],
        "url": [
          "url",
          "linkUrl",
          "link",
          "projectLinkUrl"
        ]
      },
      "impact": [
        "impact",
        "projectImpact",
        "results",
        "projectResults"
      ]
    },
    "awards_honors": {
      "title": [
        "title",
        "awardTitle",
        "honorTitle",
        "awardName",
        "honor"
      ],
      "issuer": [
        "issuer",
        "awardedBy",
        "issuingOrganization"
      ],
      "date": [
        "date",
        "awardDate",
        "dateReceived"
      ],
      "description": [
        "description",
        "awardDescription",
        "reasonAwarded",
        "significance"
      ]
    },
    "volunteer_experience": {
      "organization": [
        "organization",
        "Organization",
        "org",
        "volunteerOrganization"
      ],
      "role": [
        "role",
        "volunteerRole",
        "position"
      ],
      "location": [
        "location",
        "Location",
        "volunteerLocation",
        "place"
      ],
      "startDate": [
        "startDate",
        "start_date",
        "volunteerStart",
        "dateStarted"
      ],
      "endDate": [
        "endDate",
        "end_date",
        "volunteerEnd",
        "dateEnded"
      ],
      "description": [
        "description",
        "volunteerDescription",
        "whatYouDid",
        "responsibilities"
      ],
      "impact": [
        "impact",
        "volunteerImpact",
        "achievements",
        "results"
      ]
    },
    "job_preferences": {
      "jobType": [
        "jobType",
        "employmentType",
        "positionType",
        "workType"
      ],
      "salaryExpectation": [
        "salaryExpectation",
        "expectedSalary",
        "expected salary",
        "salary expectations",
        "salary",
        "compensation",
        "expectedCompensation",
        "expected compensation",
        "compensationExpectation",
        "compensation expectations",
        "pay expectations"
      ],
      "location": [
        "preferredLocation",
        "desiredLocation",
        "workLocation"
      ],
      "remote": [
        "remote",
        "remoteWork",
        "workFromHome",
        "telecommute"
      ]
    },
    "willing_to_relocate": [
      "willing_to_relocate",
      "willingToRelocate",
      "relocate",
      "relocation"
    ],
    "background_check_consent": [
      "background_check_consent",
      "backgroundCheck",
      "backgroundScreening",
      "consentBackgroundCheck"
    ],
    "drug_test_consent": [
      "drug_test_consent",
      "drugTest",
      "drugScreening",
      "consentDrugTest"
    ],
    "criminal_history": [
      "criminal_history",
      "criminalHistory",
      "conviction",
      "criminalRecord"
    ],
    "references": {
      "name": [
        "name",
        "referenceName",
        "contactName"
      ],
      "title": [
        "title",
        "jobTitle",
        "position"
      ],
      "company": [
        "company",
        "organization",
        "employer"
      ],
      "phone": [
        "phone",
        "phoneNumber",
        "tel"
      ],
      "email": [
        "email",
        "emailAddress"
      ],
      "relationship": [
        "relationship",
        "relationshipToApplicant",
        "howYouKnow"
      ]
    },
    "skills_detailed": {
      "skill": [
        "skill",
        "skillName",
        "technology"
      ],
      "proficiency": [
        "proficiency",
        "level",
        "expertise",
        "skillLevel"
      ],
      "yearsOfExperience": [
        "yearsOfExperience",
        "experience",
        "years"
      ]
    },
    "publications": {
      "title": [
        "title",
        "publicationTitle",
        "paperTitle"
      ],
      "authors": [
        "authors",
        "coAuthors",
        "contributors"
      ],
      "journal": [
        "journal",
        "publication",
        "venue"
      ],
      "date": [
        "date",
        "publicationDate",
        "publishedDate"
      ],
      "url": [
        "url",
        "link",
        "doi"
      ]
    },
    "reference_contacts": {
      "name": [
        "name",
        "contactName",
        "fullName"
      ],
      "email": [
        "email",
        "contactEmail",
        "emailAddress"
      ],
      "phone": [
        "phone",
        "contactPhone",
        "phoneNumber"
      ]
    },
    "resume_metadata": {
      "uploadDate": [
        "uploadDate",
        "dateUploaded",
        "created"
      ],
      "fileName": [
        "fileName",
        "originalName",
        "name"
      ],
      "fileSize": [
        "fileSize",
        "size"
      ]
    }
  }
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 405,
      },
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      config: MATCH_CONFIG,
      source: "inline-match-config",
    }),
    {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
      status: 200,
    },
  );
});
