import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle,
  X,
  AlertCircle,
  Calendar,
  Briefcase,
  GraduationCap,
  Code,
  User,
  Award,
  ExternalLink
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface MissedFieldCardProps {
  suggestion: {
    id: string;
    ai_suggestion: string;
    field_category: string;
    priority: string;
    page_url: string;
    created_at: string;
    suggested_action: {
      targetPath: string;
      missingDataType: string;
      exampleValue: any;
    };
  };
  onResolved: () => void;
  onQuickAdd: (suggestion: any) => void;
}

const categoryIcons: Record<string, any> = {
  education: GraduationCap,
  experience: Briefcase,
  skills: Code,
  personal: User,
  certifications: Award,
  other: AlertCircle
};

const priorityColors: Record<string, string> = {
  high: 'bg-red-100 text-red-800 border-red-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-blue-100 text-blue-800 border-blue-200'
};

export const MissedFieldCard: React.FC<MissedFieldCardProps> = ({
  suggestion,
  onResolved,
  onQuickAdd
}) => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const CategoryIcon = categoryIcons[suggestion.field_category || 'other'] || AlertCircle;

  const handleResolve = async (status: 'resolved' | 'dismissed' | 'wont_fix', note?: string) => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `https://yuojrygcrcpajiglbekd.supabase.co/functions/v1/resolve-missed-field`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            suggestionId: suggestion.id,
            status,
            note
          })
        }
      );

      if (!response.ok) throw new Error('Failed to resolve suggestion');

      toast({
        title: "Success",
        description: status === 'resolved'
          ? "Suggestion marked as resolved"
          : status === 'dismissed'
          ? "Suggestion dismissed"
          : "Marked as won't fix",
      });

      onResolved();
    } catch (error) {
      console.error('Error resolving suggestion:', error);
      toast({
        title: "Error",
        description: "Failed to update suggestion",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className={`p-4 border-2 ${priorityColors[suggestion.priority || 'medium']}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <CategoryIcon className="h-5 w-5" />
          <div>
            <h4 className="font-semibold capitalize text-sm">
              {suggestion.field_category || 'Other'} Information
            </h4>
            <Badge variant="outline" className="mt-1">
              {suggestion.priority || 'medium'} priority
            </Badge>
          </div>
        </div>
        <div className="text-right text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <ExternalLink className="h-3 w-3" />
            <span>{new URL(suggestion.page_url).hostname}</span>
          </div>
          <div>{new Date(suggestion.created_at).toLocaleDateString()}</div>
        </div>
      </div>

      <p className="text-sm text-gray-700 mb-3 font-medium">
        {suggestion.ai_suggestion}
      </p>

      {suggestion.suggested_action?.exampleValue && (
        <div className="bg-gray-50 p-2 rounded text-xs mb-3">
          <span className="text-gray-600">Example: </span>
          <code className="text-gray-800">{JSON.stringify(suggestion.suggested_action.exampleValue)}</code>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          onClick={() => onQuickAdd(suggestion)}
          disabled={loading}
          className="flex-1"
        >
          <CheckCircle className="h-4 w-4 mr-1" />
          Add Now
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleResolve('resolved', 'Manually resolved')}
          disabled={loading}
        >
          Mark Done
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleResolve('dismissed')}
          disabled={loading}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
};
