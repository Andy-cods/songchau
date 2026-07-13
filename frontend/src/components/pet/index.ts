// ─── Pet module barrel ──────────────────────────────────────────
export { AnimatedPet, type PetAction, type PetMood, type AnimatedPetProps } from './AnimatedPet';
export { PetAvatar } from './PetAvatar';
export {
  PET_DNA, PET_SPECIES_LIST, PET_ALLOWED_ROLES, FORM_SCALE,
  isPetSpecies, parsePetSprite,
  type PetSpecies, type PetForm, type PetExpression,
} from './pet-dna';
