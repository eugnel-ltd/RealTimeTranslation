import React, { createContext, useContext, useEffect, useState } from 'react';
import { SettingsService } from '../services/settings';
import type { AppRuntime } from '../services/accountLifetime';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode; settingsService?: SettingsService; runtime?: AppRuntime }> = ({ children, settingsService: suppliedSettings, runtime }) => {
  const settingsService = suppliedSettings ?? SettingsService.getInstance();
  const [theme, setTheme] = useState<Theme>(settingsService.getSettings().theme);

  useEffect(() => {
    if (runtime && !runtime.active) return;
    // Apply theme to document
    document.documentElement.classList.toggle('dark', theme === 'dark');
    
    // Persist theme in settings
    settingsService.updateSettings({ theme });
  }, [theme, settingsService, runtime]);

  const toggleTheme = () => {
    if (runtime && !runtime.active) return;
    setTheme((prevTheme) => (prevTheme === 'light' ? 'dark' : 'light'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
