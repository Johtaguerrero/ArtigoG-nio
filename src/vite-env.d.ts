// Reference to vite/client removed to fix "Cannot find type definition file" error
// /// <reference types="vite/client" />

// Augment the global NodeJS namespace to type process.env.API_KEY
// This avoids redeclaring 'process' which is already defined in the environment
export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      API_KEY: string;
      [key: string]: string | undefined;
    }
  }
}
