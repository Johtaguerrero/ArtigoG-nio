// Reference to vite/client removed to fix "Cannot find type definition file" error
// /// <reference types="vite/client" />

// Define process.env since it is used in the app via DefinePlugin in vite.config.ts
declare const process: {
  env: {
    API_KEY: string;
    [key: string]: string | undefined;
  }
};
