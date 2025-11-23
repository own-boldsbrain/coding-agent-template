/** @format */

"use client";

import { GitHubIcon } from "@/components/icons/github-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getEnabledAuthProviders } from "@/lib/auth/providers";
import { redirectToSignIn } from "@/lib/session/redirect-to-sign-in";
import { useState } from "react";

export function SignIn() {
  const [showDialog, setShowDialog] = useState(false);
  const [loadingGitHub, setLoadingGitHub] = useState(false);

  // Check which auth providers are enabled
  const { github: hasGitHub } = getEnabledAuthProviders();

  const handleGitHubSignIn = () => {
    setLoadingGitHub(true);
    redirectToSignIn();
  };

  return (
    <>
      <Button onClick={() => setShowDialog(true)} variant='outline' size='sm'>
        Sign in
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Sign in</DialogTitle>
            <DialogDescription>
              {hasGitHub
                ? "Sign in with GitHub to continue."
                : "No authentication providers are enabled."}
            </DialogDescription>
          </DialogHeader>

          <div className='flex flex-col gap-3 py-4'>
            {hasGitHub && (
              <Button
                onClick={handleGitHubSignIn}
                disabled={loadingGitHub}
                variant='outline'
                size='lg'
                className='w-full'>
                {loadingGitHub ? (
                  <>
                    <svg
                      className='animate-spin -ml-1 mr-2 h-4 w-4'
                      xmlns='http://www.w3.org/2000/svg'
                      fill='none'
                      viewBox='0 0 24 24'
                      aria-labelledby='loading-spinner-title'>
                      <title id='loading-spinner-title'>Loading</title>
                      <circle
                        className='opacity-25'
                        cx='12'
                        cy='12'
                        r='10'
                        stroke='currentColor'
                        strokeWidth='4'
                      />
                      <path
                        className='opacity-75'
                        fill='currentColor'
                        d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                      />
                    </svg>
                    Loading...
                  </>
                ) : (
                  <>
                    <GitHubIcon className='h-4 w-4 mr-2' />
                    Sign in with GitHub
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
