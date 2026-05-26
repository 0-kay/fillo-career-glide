import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  suggestion: {
    id: string;
    ai_suggestion: string;
    field_category: string;
    suggested_action: {
      targetPath: string;
      missingDataType: string;
      exampleValue: any;
    };
  } | null;
  profileId: string;
  onSuccess: () => void;
}

export const QuickAddModal: React.FC<QuickAddModalProps> = ({
  isOpen,
  onClose,
  suggestion,
  profileId,
  onSuccess
}) => {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  React.useEffect(() => {
    if (suggestion?.suggested_action?.exampleValue) {
      setValue(String(suggestion.suggested_action.exampleValue));
    }
  }, [suggestion]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suggestion || !value.trim()) return;

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      // Parse the targetPath to update the profile
      // For now, we'll store the value in a simple structure
      // You may need to enhance this based on your profile structure
      const updatedData = {
        // This is a simplified version - you'll need to parse targetPath properly
        // e.g., education_history[0].graduation_date -> update that specific field
        updated_at: new Date().toISOString()
      };

      // Resolve the suggestion with the updated data
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
            status: 'resolved',
            note: `Added via quick edit: ${value}`,
            updatedData
          })
        }
      );

      if (!response.ok) throw new Error('Failed to save');

      toast({
        title: "Success",
        description: "Profile updated and suggestion resolved"
      });

      onSuccess();
      onClose();
      setValue('');
    } catch (error) {
      console.error('Error saving:', error);
      toast({
        title: "Error",
        description: "Failed to save changes",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  if (!suggestion) return null;

  const renderInput = () => {
    const { missingDataType } = suggestion.suggested_action;

    switch (missingDataType) {
      case 'date':
        return (
          <Input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        );
      case 'number':
        return (
          <Input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={suggestion.suggested_action.exampleValue}
            required
          />
        );
      case 'boolean':
        return (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full p-2 border rounded"
            required
          >
            <option value="">Select...</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        );
      default:
        return (
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={suggestion.suggested_action.exampleValue}
            rows={3}
            required
          />
        );
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Missing Information</DialogTitle>
          <DialogDescription>
            {suggestion.ai_suggestion}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="quick-add-field" className="text-sm font-medium">
              {suggestion.field_category} Information
            </Label>
            <div className="mt-2">
              {renderInput()}
            </div>
            {suggestion.suggested_action.exampleValue && (
              <p className="text-xs text-gray-500 mt-1">
                Example: {JSON.stringify(suggestion.suggested_action.exampleValue)}
              </p>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !value.trim()}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save & Mark Resolved
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
