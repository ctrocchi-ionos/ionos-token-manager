export type TokenStatus = 'active' | 'expired' | 'revoked' | 'error';

export interface AccountRow {
  id: string;
  label: string;
  contract_number: number;
  admin_user_id: string | null;
  token_enc: string | null;
  token_id: string | null;
  issued_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TokenRow {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  ionos_token_id: string | null;
  ionos_user_id: string;
  ionos_group_id: string;
  sub_user_email: string;
  sub_user_password_enc: string;
  permissions: string; // JSON of PermissionFlags
  shared_resources: string; // JSON of SharedResource[]
  template_id: string | null;
  ttl_seconds: number;
  created_at: string;
  expires_at: string;
  last_regenerated_at: string | null;
  cleaned_up_at: string | null;
  status: TokenStatus;
  cleanup_on_delete: number;
}

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  permissions: string; // JSON
  shared_resource_types: string; // JSON
  is_builtin: number;
  created_at: string;
  updated_at: string;
}

export interface AuditRow {
  id: number;
  account_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: string | null; // JSON
  success: number;
  error_message: string | null;
  created_at: string;
}
