ALTER FUNCTION private.wa_api_authenticate(text,bytea) RENAME TO whatsapp_api_authenticate;
ALTER FUNCTION private.wa_api_prepare_text_send(uuid,text,text,text,text,text,text,text) RENAME TO whatsapp_api_prepare_text_send;
ALTER FUNCTION private.wa_api_finalize_text_send(uuid,text,text,text,text) RENAME TO whatsapp_api_finalize_text_send;

CREATE OR REPLACE FUNCTION private.whatsapp_api_authenticate(p_key_identifier text,p_key_hash bytea)
RETURNS TABLE(api_key_id uuid,consumer_name text,scopes text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
 return query update private.whatsapp_api_keys k
 set last_used_at=now(),status=case when k.expires_at<=now() then 'expired' else k.status end
 where k.key_identifier=p_key_identifier and k.key_hash=p_key_hash and k.status='active'
 and k.revoked_at is null and k.expires_at>now()
 returning k.id,k.consumer_name,k.scopes;
end;
$function$;

CREATE OR REPLACE FUNCTION private.whatsapp_api_finalize_text_send(
 p_message_id uuid,p_internal_status text,p_provider_message_id text DEFAULT NULL,
 p_error_code text DEFAULT NULL,p_error_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
 if p_internal_status not in ('accepted','failed','submission_unknown') then
  raise exception using errcode='22023',message='invalid_outbound_final_status';
 end if;
 update private.whatsapp_messages set internal_status=p_internal_status,
 provider_message_id=coalesce(p_provider_message_id,provider_message_id),error_code=p_error_code,
 error_message=left(p_error_message,500),
 accepted_at=case when p_internal_status='accepted' then now() else accepted_at end,updated_at=now()
 where id=p_message_id and direction='outbound' and internal_status='processing';
 if not found then raise exception using errcode='P0002',message='outbound_message_not_found_or_finalized'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.whatsapp_api_prepare_text_send(
 p_api_key_id uuid,p_to text,p_body text,p_idempotency_key text,p_request_fingerprint text,
 p_consent_category text,p_consent_scope text,p_reply_to_message_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare
 v_account private.whatsapp_accounts%rowtype;
 v_contact private.whatsapp_contacts%rowtype;
 v_conversation private.whatsapp_conversations%rowtype;
 v_existing private.whatsapp_messages%rowtype;
 v_message_id uuid;
 v_consent_status text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_api_key_id::text||':'||p_idempotency_key,0));
 select * into v_existing from private.whatsapp_messages
 where api_key_id=p_api_key_id and idempotency_key=p_idempotency_key for update;
 if found and v_existing.idempotency_expires_at>now() then
  if v_existing.request_fingerprint<>p_request_fingerprint then
   raise exception using errcode='23505',message='idempotency_key_payload_conflict';
  end if;
  select * into v_account from private.whatsapp_accounts where id=v_existing.account_id;
  return jsonb_build_object('duplicate',true,'message_id',v_existing.id,'conversation_id',v_existing.conversation_id,
   'account_id',v_existing.account_id,'phone_number_id',v_account.phone_number_id,
   'internal_status',v_existing.internal_status,'provider_message_id',v_existing.provider_message_id);
 elsif found then
  update private.whatsapp_messages set idempotency_key=null,idempotency_expires_at=null where id=v_existing.id;
 end if;
 if p_consent_category<>'transactional' then raise exception using errcode='22023',message='text_reply_requires_transactional_consent'; end if;
 select * into v_account from private.whatsapp_accounts where is_active=true order by created_at limit 1;
 if not found then raise exception using errcode='P0002',message='whatsapp_account_not_configured'; end if;
 select * into v_contact from private.whatsapp_contacts where wa_id=p_to or phone_number=p_to limit 1;
 if not found then raise exception using errcode='P0002',message='contact_not_found'; end if;
 select * into v_conversation from private.whatsapp_conversations
 where account_id=v_account.id and contact_id=v_contact.id and status='open'
 and customer_service_window_expires_at>now() order by customer_service_window_expires_at desc limit 1;
 if not found then raise exception using errcode='22023',message='customer_service_window_closed'; end if;
 select c.status into v_consent_status from private.whatsapp_contact_consents c
 where c.contact_id=v_contact.id and c.category=p_consent_category and c.scope=p_consent_scope
 order by c.occurred_at desc,c.created_at desc limit 1;
 if coalesce(v_consent_status,'missing')<>'granted' then raise exception using errcode='42501',message='active_consent_required'; end if;
 insert into private.whatsapp_messages(account_id,conversation_id,contact_id,api_key_id,direction,message_type,content,
 internal_status,idempotency_key,idempotency_expires_at,request_fingerprint)
 values(v_account.id,v_conversation.id,v_contact.id,p_api_key_id,'outbound','text',
 jsonb_build_object('to',p_to,'text',jsonb_build_object('body',p_body),'reply_to_message_id',p_reply_to_message_id,
 'consent_category',p_consent_category,'consent_scope',p_consent_scope),
 'processing',p_idempotency_key,now()+interval '24 hours',p_request_fingerprint)
 returning id into v_message_id;
 return jsonb_build_object('duplicate',false,'message_id',v_message_id,'conversation_id',v_conversation.id,
 'account_id',v_account.id,'phone_number_id',v_account.phone_number_id,'internal_status','processing','provider_message_id',null);
end;
$function$;