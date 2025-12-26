import React, { createContext, useContext, useState, useEffect } from "react";

export type ColorTheme = 
  | "default" 
  | "slate" 
  | "red" 
  | "orange" 
  | "amber" 
  | "yellow" 
  | "lime" 
  | "green" 
  | "emerald" 
  | "teal" 
  | "cyan" 
  | "sky" 
  | "blue" 
  | "indigo" 
  | "violet" 
  | "purple" 
  | "fuchsia" 
  | "pink" 
  | "rose";

interface ColorThemeContextType {
  theme: ColorTheme;
  setTheme: (theme: ColorTheme) => void;
}

const ColorThemeContext = createContext<ColorThemeContextType>({
  theme: "default",
  setTheme: () => {},
});

export function ColorThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ColorTheme>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("df:colorTheme");
      if (saved) return saved as ColorTheme;
    }
    return "default";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("df:colorTheme", theme);
    }
  }, [theme]);

  return (
    <ColorThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ColorThemeContext.Provider>
  );
}

export function useColorTheme() {
  return useContext(ColorThemeContext);
}
