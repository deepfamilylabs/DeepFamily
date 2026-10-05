/** The identity form is read only when an action begins. Its passphrase stays outside React state. */
export interface IdentityFormHandle {
  getPublicFormData: () => {
    fullName: string;
    gender: number;
    birthYear: number;
    birthMonth: number;
    birthDay: number;
    isBirthBC: boolean;
  };
  getSecretInputs: () => { passphrase: string };
  clearSecretInputs?: () => void;
}
