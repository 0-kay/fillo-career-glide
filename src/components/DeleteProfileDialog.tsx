
import React from 'react';
import '@/components/fyllo/fyllo.css';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface DeleteProfileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  profileName: string;
}

const DeleteProfileDialog = ({ isOpen, onClose, onConfirm, profileName }: DeleteProfileDialogProps) => {
  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="fy" style={{ minHeight: 0, borderRadius: 24, padding: 28, border: 0, boxShadow: '0 40px 80px -24px rgba(23,19,33,.45)' }}>
        <AlertDialogHeader>
          <AlertDialogTitle className="sg" style={{ fontWeight: 500, fontSize: 22, letterSpacing: '-0.025em' }}>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the profile "{profileName}" and all its data. 
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose} className="fy-btn fy-outline" style={{ height: 42, padding: '0 18px', borderRadius: 999, fontSize: 14 }}>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={onConfirm}
            className="fy-btn" style={{ height: 42, padding: '0 18px', borderRadius: 999, fontSize: 14, background: '#B42318', color: '#fff' }}
          >
            Delete Profile
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteProfileDialog;
