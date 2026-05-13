import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';

export interface ScreeningAnswer {
  id: string;
  question: string;
  answer: string;
  answerType: 'yes_no' | 'text' | 'select';
  answerOptions?: string[];
  keywords: string[];
  enabled: boolean;
}

const DEFAULT_SCREENING_QUESTIONS: Omit<ScreeningAnswer, 'id'>[] = [
  {
    question: "Are you authorized to work lawfully in the United States?",
    answer: "",
    answerType: "yes_no",
    keywords: ["authorized", "authorization", "lawfully", "work", "united states", "u.s.", "us"],
    enabled: true,
  },
  {
    question: "Do you now or in the future require visa sponsorship to maintain work authorization?",
    answer: "",
    answerType: "yes_no",
    keywords: ["visa", "sponsorship", "sponsor", "immigration", "h-1b", "employment-based", "require"],
    enabled: true,
  },
  {
    question: "Please select your protected veteran status.",
    answer: "",
    answerType: "select",
    answerOptions: [
      "I identify as one or more of the classifications of protected veteran listed above",
      "I am not a protected veteran",
      "I don't wish to answer",
    ],
    keywords: ["veteran", "protected veteran", "vevraa", "disabled veteran", "recently separated veteran", "campaign badge", "armed forces service medal", "opt out"],
    enabled: true,
  },
  {
    question: "Are you subject to any non-compete or non-solicitation restrictions?",
    answer: "",
    answerType: "yes_no",
    keywords: ["non-compete", "non-solicitation", "restrictions"],
    enabled: true,
  },
  {
    question: "Are you a current or former government employee?",
    answer: "",
    answerType: "yes_no",
    keywords: ["government", "employee", "former", "current"],
    enabled: true,
  },
  {
    question: "Are you a citizen of any export-controlled or sanctioned country?",
    answer: "",
    answerType: "yes_no",
    keywords: ["citizen", "sanctioned", "export", "control"],
    enabled: true,
  },
  {
    question: "Do you have citizenship or permanent residency in an additional country?",
    answer: "",
    answerType: "yes_no",
    keywords: ["citizenship", "nationality", "additional", "residency"],
    enabled: true,
  },
  {
    question: "Are you at least 18 years of age?",
    answer: "",
    answerType: "yes_no",
    keywords: ["age", "eighteen", "years"],
    enabled: true,
  },
  {
    question: "Are you willing to undergo a background check?",
    answer: "",
    answerType: "yes_no",
    keywords: ["background", "check", "willing"],
    enabled: true,
  },
  {
    question: "What are your salary expectations?",
    answer: "",
    answerType: "text",
    keywords: ["salary", "compensation", "expectations", "pay"],
    enabled: true,
  },
  {
    question: "How did you hear about this position?",
    answer: "",
    answerType: "text",
    keywords: ["hear", "heard", "position", "source", "referral"],
    enabled: true,
  },
  {
    question: "Please select your highest level of education.",
    answer: "",
    answerType: "text",
    keywords: ["highest", "level", "education", "degree", "school", "diploma", "ged", "bachelor", "master", "doctorate"],
    enabled: true,
  },
  {
    question: "Please select your gender.",
    answer: "",
    answerType: "text",
    keywords: ["gender", "male", "female", "not listed", "opt out", "eeo", "demographic"],
    enabled: true,
  },
  {
    question: "Please select your race or ethnicity.",
    answer: "",
    answerType: "select",
    answerOptions: [
      "Hispanic or Latino",
      "American Indian or Alaska Native (Not Hispanic or Latino)",
      "Asian (Not Hispanic or Latino)",
      "Black or African American (Not Hispanic or Latino)",
      "Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)",
      "Two or More Races (Not Hispanic or Latino)",
      "White (Not Hispanic or Latino)",
      "Opt Out",
    ],
    keywords: ["race", "ethnicity", "hispanic", "latino", "asian", "black", "african american", "white", "native", "pacific islander", "two or more", "opt out", "eeo", "demographic"],
    enabled: true,
  },
];

function generateId(): string {
  return crypto.randomUUID();
}

function normalizeScreeningAnswer(answer: ScreeningAnswer): ScreeningAnswer {
  if (answer.question.trim().toLowerCase() === "please select your protected veteran status.") {
    return {
      ...answer,
      answerType: "select",
      answerOptions: [
        "I identify as one or more of the classifications of protected veteran listed above",
        "I am not a protected veteran",
        "I don't wish to answer",
      ],
    };
  }
  if (answer.question.trim().toLowerCase() === "please select your race or ethnicity.") {
    return {
      ...answer,
      answerType: "select",
      answerOptions: [
        "Hispanic or Latino",
        "American Indian or Alaska Native (Not Hispanic or Latino)",
        "Asian (Not Hispanic or Latino)",
        "Black or African American (Not Hispanic or Latino)",
        "Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)",
        "Two or More Races (Not Hispanic or Latino)",
        "White (Not Hispanic or Latino)",
        "Opt Out",
      ],
    };
  }
  return answer;
}

interface ScreeningQuestionsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (answers: ScreeningAnswer[]) => void;
  initialAnswers?: ScreeningAnswer[];
}

const ScreeningQuestionsDialog = ({
  isOpen,
  onClose,
  onSave,
  initialAnswers,
}: ScreeningQuestionsDialogProps) => {
  const [answers, setAnswers] = useState<ScreeningAnswer[]>([]);
  const [newQuestion, setNewQuestion] = useState('');
  const [newType, setNewType] = useState<'yes_no' | 'text'>('yes_no');
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialAnswers && initialAnswers.length > 0) {
        const existingQuestions = new Set(
          initialAnswers.map((a) => a.question.trim().toLowerCase())
        );

        const missingDefaults = DEFAULT_SCREENING_QUESTIONS
          .filter((q) => !existingQuestions.has(q.question.trim().toLowerCase()))
          .map((q) => ({ ...q, id: generateId() }));

        setAnswers([...initialAnswers.map(normalizeScreeningAnswer), ...missingDefaults]);
      } else {
        setAnswers(
          DEFAULT_SCREENING_QUESTIONS.map((q) => ({ ...q, id: generateId() }))
        );
      }
    }
  }, [isOpen, initialAnswers]);

  const updateAnswer = (id: string, value: string) => {
    setAnswers((prev) =>
      prev.map((a) => (a.id === id ? { ...a, answer: value } : a))
    );
  };

  const removeQuestion = (id: string) => {
    setAnswers((prev) => prev.filter((a) => a.id !== id));
  };

  const addCustomQuestion = () => {
    if (!newQuestion.trim()) return;
    const words = newQuestion.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    setAnswers((prev) => [
      ...prev,
      {
        id: generateId(),
        question: newQuestion.trim(),
        answer: '',
        answerType: newType,
        keywords: words,
        enabled: true,
      },
    ]);
    setNewQuestion('');
    setNewType('yes_no');
    setShowAddForm(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Screening Questions</DialogTitle>
          <DialogDescription>
            Answer common screening questions. These will be auto-filled on Workday and other job sites.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4 pr-1">
          {answers.map((item) => (
            <div key={item.id} className="border rounded-lg p-4 bg-gray-50 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <Label className="text-sm font-medium leading-snug flex-1">
                  {item.question}
                </Label>
                <button
                  type="button"
                  onClick={() => removeQuestion(item.id)}
                  className="text-gray-400 hover:text-red-500 shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {item.answerType === 'yes_no' ? (
                <Select
                  value={item.answer}
                  onValueChange={(val) => updateAnswer(item.id, val)}
                >
                  <SelectTrigger className="w-full bg-white">
                    <SelectValue placeholder="Select answer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              ) : item.answerType === 'select' ? (
                <Select
                  value={item.answer}
                  onValueChange={(val) => updateAnswer(item.id, val)}
                >
                  <SelectTrigger className="w-full bg-white">
                    <SelectValue placeholder="Select answer" />
                  </SelectTrigger>
                  <SelectContent>
                    {(item.answerOptions || []).map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={item.answer}
                  onChange={(e) => updateAnswer(item.id, e.target.value)}
                  placeholder="Type your answer..."
                  className="bg-white"
                />
              )}
            </div>
          ))}

          {showAddForm ? (
            <div className="border rounded-lg p-4 border-dashed border-blue-300 bg-blue-50 space-y-3">
              <Input
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                placeholder="Enter your question..."
                className="bg-white"
              />
              <div className="flex items-center gap-3">
                <Select
                  value={newType}
                  onValueChange={(val) => setNewType(val as 'yes_no' | 'text')}
                >
                  <SelectTrigger className="w-40 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes_no">Yes / No</SelectItem>
                    <SelectItem value="text">Text</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={addCustomQuestion}>
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewQuestion('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full border-dashed"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="h-4 w-4 mr-2" /> Add Custom Question
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Skip
          </Button>
          <Button onClick={() => onSave(answers.filter((a) => a.answer))}>
            Save Answers
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ScreeningQuestionsDialog;
