'use client';

// ─── useMyAvatarPet — pet đang làm avatar của user hiện tại ────────────────
//
// Dùng chung queryKey ['my-pets'] với trang /profile → khi user đổi avatar
// (profile invalidate 'my-pets') header tự cập nhật, không cần refetch tay.
// BE /me/pets KHÔNG cho viewer/director (require_role trong pet.py) →
// enabled theo PET_ALLOWED_ROLES để khỏi dính 403 vô nghĩa.

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { PET_ALLOWED_ROLES, isPetSpecies, type PetForm, type PetSpecies } from './pet-dna';

export interface MyPetLite {
  id: string;
  species: string;
  nickname: string;
  current_form: number;
  level: number;
  exp: number;
  is_avatar: boolean;
}

export function useMyAvatarPet(): { species: PetSpecies; form: PetForm; nickname: string } | null {
  const { user } = useAuth();
  const allowed = !!user && PET_ALLOWED_ROLES.has(user.role);

  const { data } = useQuery<{ data: MyPetLite[] }>({
    queryKey: ['my-pets'],
    queryFn: () => api.get('/api/v1/me/pets'),
    enabled: allowed,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const avatarPet = (data?.data ?? []).find((p) => p.is_avatar);
  if (!avatarPet || !isPetSpecies(avatarPet.species)) return null;
  const form = (avatarPet.current_form === 2 || avatarPet.current_form === 3
    ? avatarPet.current_form : 1) as PetForm;
  return { species: avatarPet.species, form, nickname: avatarPet.nickname };
}
