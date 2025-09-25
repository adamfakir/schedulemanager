import { useEffect } from 'react';

export const usePageTitle = (title: string) => {
  useEffect(() => {
    const originalTitle = document.title;
    document.title = title;
    
    // Cleanup function to restore original title when component unmounts
    return () => {
      document.title = originalTitle;
    };
  }, [title]);
};

export default usePageTitle;


