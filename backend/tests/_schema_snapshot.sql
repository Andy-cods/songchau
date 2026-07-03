--
-- PostgreSQL database dump
--

\restrict 04MEWBsBJgOYsybArl7QEbxgMkSUF9rv2hvSBPbA5cnTTbPQ6xFjbVFy92KeXuq

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: unaccent; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- Name: EXTENSION unaccent; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: bqms_qt_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bqms_qt_state AS ENUM (
    'NEW',
    'V1_QUOTED',
    'AWAITING_RESULT',
    'WON_INVITED',
    'LOST_EXPIRED',
    'CLOSED',
    'CANCELLED'
);


--
-- Name: business_system; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.business_system AS ENUM (
    'bqms',
    'imv'
);


--
-- Name: currency_code; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.currency_code AS ENUM (
    'VND',
    'USD',
    'RMB',
    'KRW',
    'JPY',
    'EUR',
    'CNY'
);


--
-- Name: delivery_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.delivery_status AS ENUM (
    'chua_giao',
    'dang_giao',
    'da_giao',
    'giao_mot_phan',
    'pending',
    'picked_up',
    'in_transit',
    'customs_clearance',
    'delivered',
    'completed',
    'hoan_tat'
);


--
-- Name: goods_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.goods_type AS ENUM (
    'gia_cong',
    'thuong_mai'
);


--
-- Name: notification_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_type AS ENUM (
    'workflow_request',
    'workflow_approved',
    'workflow_rejected',
    'deadline_reminder',
    'stock_alert',
    'po_received',
    'bqms_rfq_new',
    'report_ready',
    'procurement_award',
    'procurement_quote',
    'procurement_contract',
    'procurement_po',
    'procurement_delivery',
    'password_changed',
    'imv_sync_error',
    'leave_request',
    'leave_approved',
    'leave_rejected',
    'leave_cancelled',
    'task_assigned',
    'workflow_timeout',
    'workflow_update',
    'deadline_overdue',
    'deadline_upcoming',
    'imv_contract_new',
    'imv_rejection_new'
);


--
-- Name: payment_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_direction AS ENUM (
    'inbound',
    'outbound'
);


--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'pending',
    'partial_paid',
    'paid',
    'overdue',
    'disputed'
);


--
-- Name: po_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.po_status AS ENUM (
    'draft',
    'pending_approval',
    'approved',
    'sent_to_supplier',
    'confirmed',
    'in_transit',
    'partial_received',
    'received',
    'closed',
    'cancelled'
);


--
-- Name: procrastinate_job_event_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.procrastinate_job_event_type AS ENUM (
    'deferred',
    'started',
    'deferred_for_retry',
    'failed',
    'succeeded',
    'cancelled',
    'abort_requested',
    'aborted',
    'scheduled'
);


--
-- Name: procrastinate_job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.procrastinate_job_status AS ENUM (
    'todo',
    'doing',
    'succeeded',
    'failed',
    'cancelled',
    'aborting',
    'aborted'
);


--
-- Name: quotation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.quotation_status AS ENUM (
    'draft',
    'pending',
    'submitted',
    'won',
    'lost',
    'expired',
    'cancelled'
);


--
-- Name: rfq_result; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.rfq_result AS ENUM (
    'pending',
    'won',
    'lost',
    'cancelled',
    'skipped',
    'closed'
);


--
-- Name: role_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role_enum AS ENUM (
    'admin',
    'manager',
    'procurement',
    'warehouse',
    'staff',
    'accountant',
    'vendor',
    'viewer'
);


--
-- Name: samsung_po_process_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.samsung_po_process_status AS ENUM (
    'new',
    'confirmed',
    'unconfirmed',
    'shipped',
    'received',
    'invoiced',
    'closed'
);


--
-- Name: vendor_account_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.vendor_account_status AS ENUM (
    'pending',
    'active',
    'suspended',
    'rejected'
);


--
-- Name: workflow_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.workflow_status AS ENUM (
    'draft',
    'pending_l1',
    'pending_l2',
    'approved',
    'rejected',
    'cancelled'
);


--
-- Name: workflow_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.workflow_type AS ENUM (
    'purchase_approval',
    'po_approval',
    'rfq_approval',
    'bqms_quotation',
    'expense_approval',
    'task_assignment'
);


--
-- Name: audit_log_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_log_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION
        'audit_log is append-only (immutable) — UPDATE/DELETE bị cấm'
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;


--
-- Name: auto_audit_log(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_audit_log() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_old_data JSONB;
    v_new_data JSONB;
    v_user_id  UUID;
    v_action   TEXT;
    v_record_id TEXT;
BEGIN
    -- Xac dinh hanh dong
    IF TG_OP = 'INSERT' THEN
        v_action := 'INSERT';
        v_new_data := to_jsonb(NEW);
        v_old_data := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
        v_action := 'UPDATE';
        v_old_data := to_jsonb(OLD);
        v_new_data := to_jsonb(NEW);
    ELSIF TG_OP = 'DELETE' THEN
        v_action := 'DELETE';
        v_old_data := to_jsonb(OLD);
        v_new_data := NULL;
    END IF;

    -- Lay user_id tu session variable (set boi application)
    BEGIN
        v_user_id := current_setting('app.current_user_id', true)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_user_id := NULL;
    END;

    -- Lay record_id — uu tien truong 'id'
    IF TG_OP = 'DELETE' THEN
        v_record_id := v_old_data ->> 'id';
    ELSE
        v_record_id := v_new_data ->> 'id';
    END IF;

    -- Ghi vao audit_log
    INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data, created_at)
    VALUES (v_user_id, v_action, TG_TABLE_NAME, v_record_id, v_old_data, v_new_data, NOW());

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;


--
-- Name: bump_version_on_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_version_on_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.version := COALESCE(OLD.version, 0) + 1;
    RETURN NEW;
END;
$$;


--
-- Name: cleanup_expired_idempotency_keys(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_expired_idempotency_keys() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    deleted INTEGER;
BEGIN
    DELETE FROM idempotency_keys WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted;
END;
$$;


--
-- Name: fn_dossier_jobs_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_dossier_jobs_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: fn_recount_quote_batch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_recount_quote_batch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    b_id INTEGER;
    p_cnt INTEGER;
    r_cnt INTEGER;
    d_cnt INTEGER;
    e_cnt INTEGER;
    t_cnt INTEGER;
    new_status TEXT;
BEGIN
    b_id := COALESCE(NEW.batch_id, OLD.batch_id);

    SELECT
        COUNT(*) FILTER (WHERE status='pending'),
        COUNT(*) FILTER (WHERE status='running'),
        COUNT(*) FILTER (WHERE status='done'),
        COUNT(*) FILTER (WHERE status='error'),
        COUNT(*)
    INTO p_cnt, r_cnt, d_cnt, e_cnt, t_cnt
    FROM bqms_quote_batch_items
    WHERE batch_id = b_id;

    IF p_cnt = 0 AND r_cnt = 0 THEN
        IF e_cnt = 0 THEN
            new_status := 'done';
        ELSIF d_cnt = 0 THEN
            new_status := 'error';
        ELSE
            new_status := 'partial';
        END IF;
    ELSE
        new_status := 'running';
    END IF;

    UPDATE bqms_quote_batches SET
        pending_count = p_cnt,
        running_count = r_cnt,
        done_count = d_cnt,
        error_count = e_cnt,
        total_count = t_cnt,
        status = new_status,
        completed_at = CASE WHEN new_status IN ('done','error','partial')
                            AND completed_at IS NULL THEN NOW()
                            ELSE completed_at END
    WHERE id = b_id;

    RETURN NULL;
END;
$$;


--
-- Name: fn_to_vnd(numeric, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_to_vnd(amount numeric, cur text, on_date date) RETURNS numeric
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE r NUMERIC;
BEGIN
    IF amount IS NULL THEN RETURN NULL; END IF;
    IF cur IS NULL OR UPPER(cur) IN ('VND','') THEN RETURN amount; END IF;
    SELECT rate INTO r
      FROM exchange_rates
     WHERE to_currency::text = 'VND'
       AND from_currency::text = UPPER(cur)
       AND (on_date IS NULL OR rate_date <= on_date)
     ORDER BY rate_date DESC
     LIMIT 1;
    IF r IS NULL THEN RETURN NULL; END IF;   -- không có tỷ giá → NULL (vẫn giữ price_goc)
    RETURN amount * r;
END;
$$;


--
-- Name: gen_shipment_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gen_shipment_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    prefix TEXT;
    seq    INT;
BEGIN
    prefix := 'SH-' || TO_CHAR(NOW(), 'YYYYMM') || '-';
    SELECT COALESCE(MAX(SUBSTRING(shipment_number FROM '\d+$')::INT), 0) + 1
    INTO seq
    FROM shipments
    WHERE shipment_number LIKE prefix || '%';
    NEW.shipment_number := prefix || LPAD(seq::TEXT, 6, '0');
    RETURN NEW;
END;
$_$;


--
-- Name: gen_supplier_quote_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gen_supplier_quote_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    prefix TEXT;
    seq    INT;
BEGIN
    prefix := 'SQ-' || TO_CHAR(NOW(), 'YYYYMM') || '-';
    SELECT COALESCE(MAX(SUBSTRING(quote_number FROM '\d+$')::INT), 0) + 1
    INTO seq
    FROM supplier_quotes
    WHERE quote_number LIKE prefix || '%';
    NEW.quote_number := prefix || LPAD(seq::TEXT, 6, '0');
    RETURN NEW;
END;
$_$;


--
-- Name: generate_po_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_po_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.po_number IS NULL OR NEW.po_number = '' THEN
        NEW.po_number := 'PO-' || TO_CHAR(NOW(), 'YYYYMM') || '-' ||
                          LPAD(NEXTVAL('po_number_seq')::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: leave_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_policy (
    id bigint NOT NULL,
    role public.role_enum,
    department text,
    annual_days numeric(4,1) DEFAULT 12 NOT NULL,
    sick_days numeric(4,1) DEFAULT 30 NOT NULL,
    personal_days numeric(4,1) DEFAULT 3 NOT NULL,
    maternity_days numeric(4,1) DEFAULT 180 NOT NULL,
    carry_over_max_days numeric(4,1) DEFAULT 0 NOT NULL,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: get_leave_policy(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_leave_policy(p_user uuid) RETURNS public.leave_policy
    LANGUAGE sql STABLE
    AS $$
    SELECT lp.*
    FROM users u
    JOIN leave_policy lp
      ON ((lp.role       = u.role)       OR lp.role       IS NULL)
     AND ((lp.department = u.department) OR lp.department IS NULL)
    WHERE u.id = p_user
      AND lp.is_active = true
    ORDER BY (lp.role IS NOT NULL)::int DESC,
             (lp.department IS NOT NULL)::int DESC
    LIMIT 1;
$$;


--
-- Name: immutable_unaccent(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.immutable_unaccent(text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_catalog'
    AS $_$
    SELECT public.unaccent($1);
$_$;


--
-- Name: notify_workflow_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_workflow_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.current_status IS DISTINCT FROM NEW.current_status THEN
        PERFORM pg_notify(
            'workflow_change',
            json_build_object(
                'id', NEW.id,
                'type', NEW.workflow_type,
                'old_status', OLD.current_status,
                'new_status', NEW.current_status,
                'assigned_to', NEW.assigned_to,
                'created_by', NEW.created_by
            )::TEXT
        );
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: procrastinate_cancel_job(bigint, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procrastinate_cancel_job(job_id bigint, abort boolean, delete_job boolean) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
    _job_id bigint;
BEGIN
    IF delete_job THEN
        DELETE FROM procrastinate_jobs
        WHERE id = job_id AND status = 'todo'
        RETURNING id INTO _job_id;
    END IF;
    IF _job_id IS NULL THEN
        IF abort THEN
            UPDATE procrastinate_jobs
            SET status = CASE status
                WHEN 'todo' THEN 'cancelled'::procrastinate_job_status
                WHEN 'doing' THEN 'aborting'::procrastinate_job_status
            END
            WHERE id = job_id AND status IN ('todo', 'doing')
            RETURNING id INTO _job_id;
        ELSE
            UPDATE procrastinate_jobs
            SET status = 'cancelled'::procrastinate_job_status
            WHERE id = job_id AND status = 'todo'
            RETURNING id INTO _job_id;
        END IF;
    END IF;
    RETURN _job_id;
END;
$$;


--
-- Name: procrastinate_defer_job(character varying, character varying, text, text, jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procrastinate_defer_job(queue_name character varying, task_name character varying, lock text, queueing_lock text, args jsonb, scheduled_at timestamp with time zone) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
	job_id bigint;
BEGIN
    INSERT INTO procrastinate_jobs (queue_name, task_name, lock, queueing_lock, args, scheduled_at)
    VALUES (queue_name, task_name, lock, queueing_lock, args, scheduled_at)
    RETURNING id INTO job_id;

    RETURN job_id;
END;
$$;


--
-- Name: procrastinate_defer_job(character varying, character varying, integer, text, text, jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procrastinate_defer_job(queue_name character varying, task_name character varying, priority integer, lock text, queueing_lock text, args jsonb, scheduled_at timestamp with time zone) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
	job_id bigint;
BEGIN
    INSERT INTO procrastinate_jobs (queue_name, task_name, priority, lock, queueing_lock, args, scheduled_at)
    VALUES (queue_name, task_name, priority, lock, queueing_lock, args, scheduled_at)
    RETURNING id INTO job_id;

    RETURN job_id;
END;
$$;


--
-- Name: procrastinate_defer_periodic_job(character varying, character varying, character varying, character varying, character varying, bigint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procrastinate_defer_periodic_job(_queue_name character varying, _lock character varying, _queueing_lock character varying, _task_name character varying, _periodic_id character varying, _defer_timestamp bigint, _args jsonb) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
	_job_id bigint;
	_defer_id bigint;
BEGIN

    INSERT
        INTO procrastinate_periodic_defers (task_name, periodic_id, defer_timestamp)
        VALUES (_task_name, _periodic_id, _defer_timestamp)
        ON CONFLICT DO NOTHING
        RETURNING id into _defer_id;

    IF _defer_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE procrastinate_periodic_defers
        SET job_id = procrastinate_defer_job(
                _queue_name,
                _task_name,
                0,
                _lock,
                _queueing_lock,
                _args,
                NULL
            )
        WHERE id = _defer_id
        RETURNING job_id INTO _job_id;

    DELETE
        FROM procrastinate_periodic_defers
        USING (
            SELECT id
            FROM procrastinate_periodic_defers
            WHERE procrastinate_periodic_defers.task_name = _task_name
            AND procrastinate_periodic_defers.periodic_id = _periodic_id
            AND procrastinate_periodic_defers.defer_timestamp < _defer_timestamp
            ORDER BY id
            FOR UPDATE
        ) to_delete
        WHERE procrastinate_periodic_defers.id = to_delete.id;

    RETURN _job_id;
END;
$$;


--
-- Name: procrastinate_defer_periodic_job(character varying, character varying, character varying, character varying, integer, character varying, bigint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procrastinate_defer_periodic_job(_queue_name character varying, _lock character varying, _queueing_lock character varying, _task_name character varying, _priority integer, _periodic_id character varying, _defer_timestamp bigint, _args jsonb) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
	_job_id bigint;
	_defer_id bigint;
BEGIN

    INSERT
        INTO procrastinate_periodic_defers (task_name, periodic_id, defer_timestamp)
        VALUES (_task_name, _periodic_id, _defer_timestamp)
        ON CONFLICT DO NOTHING
        RETURNING id into _defer_id;

    IF _defer_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE procrastinate_periodic_defers
        SET job_id = procrastinate_defer_job(
                _queue_name,
                _task_name,
                _priority,
                _lock,
                _queueing_lock,
                _args,
                NULL
            )
        WHERE id = _defer_id
        RETURNING job_id INTO _job_id;

    DELETE
        FROM procrastinate_periodic_defers
        USING (
            SELECT id
            FROM procrastinate_periodic_defers
            WHERE procrastinate_periodic_defers.task_name = _task_name
            AND procrastinate_periodic_defers.periodic_id = _periodic_id
            AND procrastinate_periodic_defers.defer_timestamp < _defer_timestamp
            ORDER BY id
            FOR UPDATE
        ) to_delete
        WHERE procrastinate_periodic_defers.id = to_delete.id;

    RETURN _job_id;
END;
$$;


--
-- Name: procrastinate_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procrastinate_jobs (
    id bigint NOT NULL,
    queue_name character varying(128) NOT NULL,
    task_name character varying(128) NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    lock text,
    queueing_lock text,
    args jsonb DEFAULT '{}'::jsonb NOT NULL,
    status public.procrastinate_job_status DEFAULT 'todo'::public.procrastinate_job_status NOT NULL,
    scheduled_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL
);


--
-- Name: procrastinate_fetch_job(character varying[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procrastinate_fetch_job(target_queue_names character varying[]) RETURNS public.procrastinate_jobs
    LANGUAGE plpgsql
    AS $$
DECLARE
	found_jobs procrastinate_jobs;
BEGIN
    WITH candidate AS (
        SELECT jobs.*
            FROM procrastinate_jobs AS jobs
            WHERE
                -- reject the job if its lock has earlier jobs
                NOT EXISTS (
                    SELECT 1
                        FROM procrastinate_jobs AS earlier_jobs
                        WHERE
                            jobs.lock IS NOT NULL
                            AND earlier_jobs.lock = jobs.lock
                            AND earlier_jobs.status IN ('todo', 'doing', 'aborting')
                            AND earlier_jobs.id < jobs.id)
                AND jobs.status = 'todo'
                AND (target_queue_names IS NULL OR jobs.queue_name = ANY( target_queue_names ))
                AND (jobs.scheduled_at IS NULL OR jobs.scheduled_at <= now())
            ORDER BY jobs.priority DESC, jobs.id ASC LIMIT 1
            FOR UPDATE OF jobs SKIP LOCKED
    )
    UPDATE procrastinate_jobs
        SET status = 'doing'
        FROM candidate
        WHERE procrastinate_jobs.id = candidate.id
        RETURNING procrastinate_jobs.* INTO found_jobs;

	RETURN found_jobs;
END;
$$;


--
-- Name: procrastinate_finish_job(bigint, public.procrastinate_job_status, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procrastinate_finish_job(job_id bigint, end_status public.procrastinate_job_status, delete_job boolean) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    _job_id bigint;
BEGIN
    IF end_status NOT IN ('succeeded', 'failed', 'aborted') THEN
        RAISE 'End status should be either "succeeded", "failed" or "aborted" (job id: %)', job_id;
    END IF;
    IF delete_job THEN
        DELETE FROM procrastinate_jobs
        WHERE id = job_id AND status IN ('todo', 'doing', 'aborting')
        RETURNING id INTO _job_id;
    ELSE
        UPDATE procrastinate_jobs
        SET status = end_status,
            attempts =
                CASE
                    WHEN status = 'doing' THEN attempts + 1
                    ELSE attempts
                END
        WHERE id = job_id AND status IN ('todo', 'doing', 'aborting')
        RETURNING id INTO _job_id;
    END IF;
    IF _job_id IS NULL THEN
        RAISE 'Job was not found or not in "doing", "todo" or "aborting" status (job id: %)', job_id;
    END IF;
END;
$$;


--
-- Name: procrastinate_finish_job(integer, public.procrastinate_job_status, timestamp with time zone, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procrastinate_finish_job(job_id integer, end_status public.procrastinate_job_status, next_scheduled_at timestamp with time zone, delete_job boolean) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    _job_id bigint;
BEGIN
    IF end_status NOT IN ('succeeded', 'failed') THEN
        RAISE 'End status should be either "succeeded" or "failed" (job id: %)', job_id;
    END IF;
    IF delete_job THEN
        DELETE FROM procrastinate_jobs
        WHERE id = job_id AND status IN ('todo', 'doing')
        RETURNING id INTO _job_id;
    ELSE
        UPDATE procrastinate_jobs
        SET status = end_status,
            attempts =
                CASE
                    WHEN status = 'doing' THEN attempts + 1
                    ELSE attempts
                END
        WHERE id = job_id AND status IN ('todo', 'doing')
        RETURNING id INTO _job_id;
    END IF;
    IF _job_id IS NULL THEN
        RAISE 'Job was not found or not in "doing" or "todo" status (job id: %)', job_id;
    END IF;
END;
$$;


--
-- Name: procrastinate_notify_queue(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procrastinate_notify_queue() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	PERFORM pg_notify('procrastinate_queue#' || NEW.queue_name, NEW.task_name);
	PERFORM pg_notify('procrastinate_any_queue', NEW.task_name);
	RETURN NEW;
END;
$$;


--
-- Name: procrastinate_retry_job(bigint, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procrastinate_retry_job(job_id bigint, retry_at timestamp with time zone) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    _job_id bigint;
BEGIN
    UPDATE procrastinate_jobs
    SET status = 'todo',
        attempts = attempts + 1,
        scheduled_at = retry_at
    WHERE id = job_id AND status = 'doing'
    RETURNING id INTO _job_id;
    IF _job_id IS NULL THEN
        RAISE 'Job was not found or not in "doing" status (job id: %)', job_id;
    END IF;
END;
$$;


--
-- Name: procrastinate_retry_job(bigint, timestamp with time zone, integer, character varying, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procrastinate_retry_job(job_id bigint, retry_at timestamp with time zone, new_priority integer, new_queue_name character varying, new_lock character varying) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    _job_id bigint;
BEGIN
    UPDATE procrastinate_jobs
    SET status = 'todo',
        attempts = attempts + 1,
        scheduled_at = retry_at,
        priority = COALESCE(new_priority, priority),
        queue_name = COALESCE(new_queue_name, queue_name),
        lock = COALESCE(new_lock, lock)
    WHERE id = job_id AND status = 'doing'
    RETURNING id INTO _job_id;
    IF _job_id IS NULL THEN
        RAISE 'Job was not found or not in "doing" status (job id: %)', job_id;
    END IF;
END;
$$;


--
-- Name: procrastinate_trigger_scheduled_events_procedure(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procrastinate_trigger_scheduled_events_procedure() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO procrastinate_events(job_id, type, at)
        VALUES (NEW.id, 'scheduled'::procrastinate_job_event_type, NEW.scheduled_at);

	RETURN NEW;
END;
$$;


--
-- Name: procrastinate_trigger_status_events_procedure_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procrastinate_trigger_status_events_procedure_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO procrastinate_events(job_id, type)
        VALUES (NEW.id, 'deferred'::procrastinate_job_event_type);
	RETURN NEW;
END;
$$;


--
-- Name: procrastinate_trigger_status_events_procedure_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procrastinate_trigger_status_events_procedure_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    WITH t AS (
        SELECT CASE
            WHEN OLD.status = 'todo'::procrastinate_job_status
                AND NEW.status = 'doing'::procrastinate_job_status
                THEN 'started'::procrastinate_job_event_type
            WHEN OLD.status = 'doing'::procrastinate_job_status
                AND NEW.status = 'todo'::procrastinate_job_status
                THEN 'deferred_for_retry'::procrastinate_job_event_type
            WHEN OLD.status = 'doing'::procrastinate_job_status
                AND NEW.status = 'failed'::procrastinate_job_status
                THEN 'failed'::procrastinate_job_event_type
            WHEN OLD.status = 'doing'::procrastinate_job_status
                AND NEW.status = 'succeeded'::procrastinate_job_status
                THEN 'succeeded'::procrastinate_job_event_type
            WHEN OLD.status = 'todo'::procrastinate_job_status
                AND (
                    NEW.status = 'cancelled'::procrastinate_job_status
                    OR NEW.status = 'failed'::procrastinate_job_status
                    OR NEW.status = 'succeeded'::procrastinate_job_status
                )
                THEN 'cancelled'::procrastinate_job_event_type
            WHEN OLD.status = 'doing'::procrastinate_job_status
                AND NEW.status = 'aborting'::procrastinate_job_status
                THEN 'abort_requested'::procrastinate_job_event_type
            WHEN (
                    OLD.status = 'doing'::procrastinate_job_status
                    OR OLD.status = 'aborting'::procrastinate_job_status
                )
                AND NEW.status = 'aborted'::procrastinate_job_status
                THEN 'aborted'::procrastinate_job_event_type
            ELSE NULL
        END as event_type
    )
    INSERT INTO procrastinate_events(job_id, type)
        SELECT NEW.id, t.event_type
        FROM t
        WHERE t.event_type IS NOT NULL;
	RETURN NEW;
END;
$$;


--
-- Name: procrastinate_unlink_periodic_defers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procrastinate_unlink_periodic_defers() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE procrastinate_periodic_defers
    SET job_id = NULL
    WHERE job_id = OLD.id;
    RETURN OLD;
END;
$$;


--
-- Name: procurement_audit_log_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procurement_audit_log_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION
        'procurement_audit_log bất biến: thao tác % bị chặn (audit log chỉ được ghi thêm)',
        TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;


--
-- Name: set_dossier_attempt_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_dossier_attempt_no() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.delivery_attempt_no IS NULL OR NEW.delivery_attempt_no = 1 THEN
        SELECT COALESCE(MAX(delivery_attempt_no), 0) + 1
          INTO NEW.delivery_attempt_no
          FROM bqms_dossier_jobs
         WHERE po_numbers = NEW.po_numbers
           AND sev_type = NEW.sev_type
           AND status IN ('done', 'queued', 'running', 'awaiting_confirm',
                          'invoice_ready', 'po_downloaded', 'excel_built');
        SELECT id INTO NEW.previous_dossier_id
          FROM bqms_dossier_jobs
         WHERE po_numbers = NEW.po_numbers
           AND sev_type = NEW.sev_type
           AND delivery_attempt_no = NEW.delivery_attempt_no - 1
         ORDER BY created_at DESC LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: set_updated_at_payment_requests(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at_payment_requests() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


--
-- Name: set_updated_at_sourcing(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at_sourcing() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: set_updated_at_sourcing_orders(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at_sourcing_orders() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


--
-- Name: tg_spr_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_spr_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$;


--
-- Name: tg_ssp_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_ssp_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$;


--
-- Name: update_task_assignments_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_task_assignments_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: accounts_payable; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts_payable (
    id bigint NOT NULL,
    supplier_id bigint NOT NULL,
    po_id bigint,
    invoice_number text,
    invoice_date date NOT NULL,
    due_date date NOT NULL,
    amount numeric(15,2) NOT NULL,
    currency public.currency_code DEFAULT 'USD'::public.currency_code,
    exchange_rate numeric(15,4),
    amount_vnd numeric(18,0),
    paid_amount numeric(15,2) DEFAULT 0 NOT NULL,
    status public.payment_status DEFAULT 'pending'::public.payment_status NOT NULL,
    payment_terms text,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    procurement_po_id bigint,
    delivery_id bigint,
    vendor_id bigint
);


--
-- Name: TABLE accounts_payable; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.accounts_payable IS 'Cong no phai tra — theo doi thanh toan NCC';


--
-- Name: accounts_payable_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accounts_payable_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: accounts_payable_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accounts_payable_id_seq OWNED BY public.accounts_payable.id;


--
-- Name: accounts_receivable; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts_receivable (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    invoice_id bigint,
    sales_order_id bigint,
    invoice_number text,
    invoice_date date NOT NULL,
    due_date date NOT NULL,
    amount numeric(15,2) NOT NULL,
    currency public.currency_code DEFAULT 'VND'::public.currency_code,
    paid_amount numeric(15,2) DEFAULT 0 NOT NULL,
    status public.payment_status DEFAULT 'pending'::public.payment_status NOT NULL,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sourcing_order_id bigint,
    payment_request_id bigint,
    delivery_id bigint,
    chain_code text
);


--
-- Name: TABLE accounts_receivable; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.accounts_receivable IS 'Cong no phai thu — theo doi thanh toan khach hang';


--
-- Name: accounts_receivable_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accounts_receivable_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: accounts_receivable_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accounts_receivable_id_seq OWNED BY public.accounts_receivable.id;


--
-- Name: ai_classification_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_classification_results (
    id bigint NOT NULL,
    rfq_id bigint,
    bqms_code text,
    specification text,
    classification text NOT NULL,
    confidence numeric(5,4),
    reasoning text,
    similar_history jsonb,
    model_version text DEFAULT 'gemini-1.5-flash'::text,
    accepted boolean,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    batch_id text,
    CONSTRAINT ai_classification_results_classification_check CHECK ((classification = ANY (ARRAY['chot'::text, 'xem'::text, 'bo'::text])))
);


--
-- Name: ai_classification_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_classification_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_classification_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_classification_results_id_seq OWNED BY public.ai_classification_results.id;


--
-- Name: app_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: attendance_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_incidents (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    department text,
    incident_date date NOT NULL,
    incident_type text NOT NULL,
    expected_time time without time zone,
    actual_time time without time zone,
    minutes_off integer NOT NULL,
    reason text,
    created_by uuid NOT NULL,
    acknowledged_by uuid,
    acknowledged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attendance_incidents_incident_type_check CHECK ((incident_type = ANY (ARRAY['late'::text, 'early_leave'::text, 'no_show'::text]))),
    CONSTRAINT attendance_incidents_minutes_off_check CHECK ((minutes_off >= 0))
);


--
-- Name: attendance_incidents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_incidents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_incidents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_incidents_id_seq OWNED BY public.attendance_incidents.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    user_id uuid,
    user_email text,
    action text NOT NULL,
    table_name text NOT NULL,
    record_id text,
    old_data jsonb,
    new_data jsonb,
    ip_address inet,
    user_agent text,
    request_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE audit_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_log IS 'Nhat ky he thong — bat bien, ghi lai moi thay doi';


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: backup_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backup_log (
    id bigint NOT NULL,
    backup_type text NOT NULL,
    file_path text,
    file_size_bytes bigint,
    tables_count integer,
    rows_count bigint,
    duration_seconds integer,
    status text DEFAULT 'running'::text NOT NULL,
    verified boolean DEFAULT false,
    verified_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT backup_log_backup_type_check CHECK ((backup_type = ANY (ARRAY['full'::text, 'incremental'::text, 'manual'::text]))),
    CONSTRAINT backup_log_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: backup_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.backup_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: backup_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.backup_log_id_seq OWNED BY public.backup_log.id;


--
-- Name: bqms_code_primary_image; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_code_primary_image (
    bqms_code text NOT NULL,
    image_path text NOT NULL,
    chosen_by text,
    chosen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bqms_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_contacts (
    id bigint NOT NULL,
    email_username text NOT NULL,
    full_name text NOT NULL,
    delivery_info text,
    phone text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_driver boolean DEFAULT false,
    cccd_number text,
    cccd_image_path text,
    license_plate text,
    license_plate_image_path text,
    vehicle_type text,
    driver_notes text
);


--
-- Name: COLUMN bqms_contacts.is_driver; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_contacts.is_driver IS 'true = contact này là người giao hàng (có CCCD + biển số xe)';


--
-- Name: COLUMN bqms_contacts.cccd_image_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_contacts.cccd_image_path IS 'Đường dẫn file ảnh CCCD trên /data/driver-docs/{id}/cccd.{ext}';


--
-- Name: COLUMN bqms_contacts.license_plate_image_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_contacts.license_plate_image_path IS 'Đường dẫn file ảnh biển số xe trên /data/driver-docs/{id}/plate.{ext}';


--
-- Name: bqms_contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_contacts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_contacts_id_seq OWNED BY public.bqms_contacts.id;


--
-- Name: bqms_contract_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_contract_items (
    id bigint NOT NULL,
    contract_id bigint NOT NULL,
    item_no text,
    bqms_code text,
    description text,
    specification text,
    quantity numeric(15,3),
    unit text,
    unit_price numeric(15,4),
    amount numeric(15,2),
    currency text DEFAULT 'VND'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE bqms_contract_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_contract_items IS 'Line items của contract — 1:N với bqms_contracts';


--
-- Name: bqms_contract_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_contract_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_contract_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_contract_items_id_seq OWNED BY public.bqms_contract_items.id;


--
-- Name: bqms_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_contracts (
    id bigint NOT NULL,
    contract_no text NOT NULL,
    request_no text,
    contract_kind text,
    contract_type text,
    subject text,
    status text,
    amount numeric(15,2),
    currency text DEFAULT 'VND'::text,
    contract_period text,
    contract_start date,
    contract_end date,
    vendor_name text,
    created_by_samsung text,
    reconciliation text,
    won_quotation_id bigint,
    rfq_id bigint,
    raw_data jsonb,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE bqms_contracts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_contracts IS 'Hợp đồng đã ký với Samsung, merge từ vendor_portal_staging module=contract (Thang 2026-05-12)';


--
-- Name: COLUMN bqms_contracts.contract_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_contracts.contract_no IS 'CO26xxxxx — unique';


--
-- Name: COLUMN bqms_contracts.request_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_contracts.request_no IS 'RFQ number gốc — match với bqms_rfq.rfq_number';


--
-- Name: bqms_contracts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_contracts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_contracts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_contracts_id_seq OWNED BY public.bqms_contracts.id;


--
-- Name: bqms_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_deliveries (
    id bigint NOT NULL,
    samsung_po_id bigint,
    po_date date,
    po_number text,
    shipping_no text,
    quotation_no text,
    product_id bigint,
    bqms_code text,
    specification text,
    quantity numeric(12,3),
    unit text DEFAULT 'EA'::text,
    unit_price numeric(15,4),
    amount numeric(15,2),
    sev_type text,
    buyer_email text,
    recipient_name text,
    receiving_warehouse text,
    buyer_phone text,
    delivery_status public.delivery_status DEFAULT 'chua_giao'::public.delivery_status NOT NULL,
    delivery_date date,
    actual_delivered_at timestamp with time zone,
    actual_delivered_qty numeric(12,3),
    delivery_info text,
    delivery_method text,
    country_origin text,
    total_delivered_value_vnd numeric(15,2),
    data_source text DEFAULT 'excel_import'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    synced_at timestamp with time zone DEFAULT now(),
    expected_delivery_date date,
    version integer DEFAULT 0 NOT NULL,
    driver_id bigint,
    sourcing_order_id bigint,
    chain_code text,
    item_name text
);


--
-- Name: TABLE bqms_deliveries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_deliveries IS 'Giao hang BQMS — theo doi tung lan giao cho Samsung';


--
-- Name: COLUMN bqms_deliveries.driver_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_deliveries.driver_id IS 'Người giao hàng được gán cho đơn này (bqms_contacts.id with is_driver=true)';


--
-- Name: bqms_deliveries_archive_pre2026; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_deliveries_archive_pre2026 (
    id bigint,
    samsung_po_id bigint,
    po_date date,
    po_number text,
    shipping_no text,
    quotation_no text,
    product_id bigint,
    bqms_code text,
    specification text,
    quantity numeric(12,3),
    unit text,
    unit_price numeric(15,4),
    amount numeric(15,2),
    sev_type text,
    buyer_email text,
    recipient_name text,
    receiving_warehouse text,
    buyer_phone text,
    delivery_status public.delivery_status,
    delivery_date date,
    actual_delivered_at timestamp with time zone,
    actual_delivered_qty numeric(12,3),
    delivery_info text,
    delivery_method text,
    country_origin text,
    total_delivered_value_vnd numeric(15,2),
    data_source text,
    notes text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    source_hash text,
    synced_at timestamp with time zone,
    expected_delivery_date date,
    version integer
);


--
-- Name: bqms_deliveries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_deliveries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_deliveries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_deliveries_id_seq OWNED BY public.bqms_deliveries.id;


--
-- Name: bqms_deliveries_spec_bak; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_deliveries_spec_bak (
    id bigint,
    specification text
);


--
-- Name: bqms_dossier_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_dossier_jobs (
    id bigint NOT NULL,
    procrastinate_job_id bigint,
    user_id uuid,
    sev_type text NOT NULL,
    po_numbers text[] NOT NULL,
    delivery_row_ids bigint[] NOT NULL,
    form_data jsonb NOT NULL,
    shipping_no text,
    invoice_no text,
    status text DEFAULT 'queued'::text NOT NULL,
    progress_pct integer DEFAULT 0,
    progress_step text,
    output_folder text,
    files jsonb,
    error text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_heartbeat_at timestamp with time zone,
    delivery_attempt_no integer DEFAULT 1,
    is_partial boolean DEFAULT false,
    previous_dossier_id bigint,
    confirm_signal text,
    confirm_preview jsonb,
    awaiting_confirm_at timestamp with time zone,
    CONSTRAINT bqms_dossier_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'awaiting_confirm'::text, 'invoice_ready'::text, 'po_downloaded'::text, 'excel_built'::text, 'done'::text, 'failed'::text, 'cancelled'::text, 'regenerating'::text])))
);


--
-- Name: TABLE bqms_dossier_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_dossier_jobs IS 'Tạo hồ sơ giao hàng — Job orchestrate Samsung scrape (Register Delivery / PO Receipt) + Excel 6 sheet build cho 1 lượt giao hàng (multiple POs/items cùng SEV/SEVT).';


--
-- Name: COLUMN bqms_dossier_jobs.sev_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_dossier_jobs.sev_type IS 'Single company per job — multi-company batch rejected ở API.';


--
-- Name: COLUMN bqms_dossier_jobs.shipping_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_dossier_jobs.shipping_no IS 'Extracted từ Delivery Note PDF qua pdfplumber regex.';


--
-- Name: COLUMN bqms_dossier_jobs.invoice_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_dossier_jobs.invoice_no IS 'Generated {DDMMYYYY}-{N} với N counter theo ngày (reset 01 mỗi ngày).';


--
-- Name: COLUMN bqms_dossier_jobs.confirm_signal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_dossier_jobs.confirm_signal IS 'Tín hiệu user gửi khi job ở awaiting_confirm: confirm = bấm Save, cancel = đóng popup không lưu.';


--
-- Name: COLUMN bqms_dossier_jobs.confirm_preview; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_dossier_jobs.confirm_preview IS 'Snapshot popup đã điền (screenshot filename + giá trị đọc lại + cảnh báo) để user kiểm tra 100% trước khi tạo Delivery.';


--
-- Name: bqms_dossier_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_dossier_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_dossier_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_dossier_jobs_id_seq OWNED BY public.bqms_dossier_jobs.id;


--
-- Name: bqms_image_index; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_image_index (
    id bigint NOT NULL,
    bqms_code text NOT NULL,
    image_path text NOT NULL,
    source text NOT NULL,
    rfq_number text,
    file_size bigint,
    mtime timestamp with time zone,
    indexed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bqms_image_index_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_image_index_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_image_index_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_image_index_id_seq OWNED BY public.bqms_image_index.id;


--
-- Name: bqms_rfq; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_rfq (
    id bigint NOT NULL,
    rfq_number text NOT NULL,
    product_id bigint,
    bqms_code text,
    specification text,
    maker text,
    inquiry_date date,
    person_in_charge uuid,
    person_in_charge_name text,
    expected_qty numeric(12,3),
    unit text DEFAULT 'EA'::text,
    purchase_price_rmb numeric(15,4),
    purchase_price_vnd numeric(15,2),
    quoted_price_ama numeric(15,4),
    quoted_price_bqms_v1 numeric(15,4),
    quoted_price_bqms_v2 numeric(15,4),
    quoted_price_bqms_v3 numeric(15,4),
    quoted_price_bqms_v4 numeric(15,4),
    supplier_id bigint,
    supplier_name text,
    result public.rfq_result DEFAULT 'pending'::public.rfq_result,
    result_date date,
    result_updated_by uuid,
    report text,
    notes text,
    customer_source text DEFAULT 'samsung'::text,
    data_source text DEFAULT 'excel_import'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    synced_at timestamp with time zone,
    chain_code text,
    sales_order_id bigint,
    item_type character varying(2),
    requester text,
    department text,
    assigned_to uuid,
    classification_override text,
    quote_unlocked boolean DEFAULT false NOT NULL,
    bqms_pushed_at timestamp with time zone,
    bqms_pushed_round integer,
    bqms_push_status text,
    bqms_push_error text,
    bqms_push_job_id text,
    bqms_push_payload jsonb,
    bqms_push_screenshot_path text,
    bqms_push_progress_pct integer DEFAULT 0,
    bqms_push_progress_step text,
    bqms_push_started_at timestamp with time zone,
    bqms_code_norm text GENERATED ALWAYS AS (regexp_replace(upper(COALESCE(bqms_code, ''::text)), '[^A-Z0-9]'::text, ''::text, 'g'::text)) STORED,
    quoted_dt_v1 date,
    quoted_dt_v2 date,
    quoted_dt_v3 date,
    quoted_dt_v4 date,
    deadline_dt timestamp with time zone,
    deadline_raw text,
    current_round smallint,
    qt_state public.bqms_qt_state DEFAULT 'NEW'::public.bqms_qt_state,
    state_changed_at timestamp with time zone,
    last_seen_scrape_at timestamp with time zone,
    reinvited_at timestamp with time zone,
    bqms_push_round_active integer,
    bqms_push_step_index smallint,
    bqms_push_total_steps smallint,
    bqms_push_step_key text,
    bqms_push_heartbeat_at timestamp with time zone,
    CONSTRAINT bqms_rfq_classification_override_check CHECK (((classification_override IS NULL) OR (classification_override = ANY (ARRAY['TM'::text, 'GC'::text])))),
    CONSTRAINT bqms_rfq_data_source_check CHECK ((data_source = ANY (ARRAY['manual'::text, 'excel_import'::text, 'api_sync'::text, 'etl'::text, 'onedrive_sync'::text]))),
    CONSTRAINT bqms_rfq_item_type_check CHECK (((item_type)::text = ANY ((ARRAY['TM'::character varying, 'GC'::character varying])::text[])))
);


--
-- Name: TABLE bqms_rfq; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_rfq IS 'RFQ tu Samsung — yeu cau bao gia, import tu Excel/BQMS';


--
-- Name: COLUMN bqms_rfq.requester; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.requester IS 'Người Samsung yêu cầu (từ xlsx Basic Information)';


--
-- Name: COLUMN bqms_rfq.department; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.department IS 'Phòng ban Samsung order (cho thống kê)';


--
-- Name: COLUMN bqms_rfq.assigned_to; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.assigned_to IS 'Nhân viên ERP báo giá (auto-set khi POST quote, dùng cho cột Người PT)';


--
-- Name: COLUMN bqms_rfq.classification_override; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.classification_override IS 'User override của classification TM/GC. NULL = dùng auto-detect từ notes.';


--
-- Name: COLUMN bqms_rfq.quote_unlocked; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.quote_unlocked IS 'Phase H: V1-V4 buttons khóa cho tới khi user click "Báo giá" (set =true). Scrape KHÔNG set field này — chỉ user action mở khóa.';


--
-- Name: COLUMN bqms_rfq.quoted_dt_v1; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.quoted_dt_v1 IS 'Ngày user nhấn báo giá V1 (set khi quoted_price_bqms_v1 chuyển từ NULL→giá trị). Hiển thị trên BQMS table và pinned vào cell C4 của XLSX quotation.';


--
-- Name: COLUMN bqms_rfq.quoted_dt_v2; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.quoted_dt_v2 IS 'Ngày user submit báo giá V2.';


--
-- Name: COLUMN bqms_rfq.quoted_dt_v3; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.quoted_dt_v3 IS 'Ngày user submit báo giá V3.';


--
-- Name: COLUMN bqms_rfq.quoted_dt_v4; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.quoted_dt_v4 IS 'Ngày user submit báo giá V4.';


--
-- Name: COLUMN bqms_rfq.deadline_dt; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.deadline_dt IS 'Parsed Samsung submission deadline (UTC-aware). Set on UPSERT via parse_deadline().';


--
-- Name: COLUMN bqms_rfq.deadline_raw; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.deadline_raw IS 'Raw Samsung deadline string (e.g. "(GMT+07:00) 5/19/2026 23:30") for audit.';


--
-- Name: COLUMN bqms_rfq.current_round; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.current_round IS 'ERP-side round we have quoted/pushed (1..4). NOT the Samsung round — that is bqms_rfq.version.';


--
-- Name: COLUMN bqms_rfq.qt_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.qt_state IS 'Materialized QT lifecycle state. Source of truth = bqms_qt_events; this column is a cache.';


--
-- Name: COLUMN bqms_rfq.state_changed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.state_changed_at IS 'Timestamp of last qt_state transition.';


--
-- Name: COLUMN bqms_rfq.last_seen_scrape_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.last_seen_scrape_at IS 'Last time this RFQ was seen active in a bidding scrape (drives stale detection).';


--
-- Name: COLUMN bqms_rfq.reinvited_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_rfq.reinvited_at IS 'When a Samsung re-invite (round bump after AWAITING_RESULT) was detected.';


--
-- Name: bqms_kpi; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.bqms_kpi AS
 SELECT count(*) AS total_rfqs,
    count(*) FILTER (WHERE (result = 'won'::public.rfq_result)) AS won_count,
    count(*) FILTER (WHERE (result = 'lost'::public.rfq_result)) AS lost_count,
    count(*) FILTER (WHERE (result = 'pending'::public.rfq_result)) AS pending_count,
    round((((count(*) FILTER (WHERE (result = 'won'::public.rfq_result)))::numeric * 100.0) / (NULLIF(count(*) FILTER (WHERE (result = ANY (ARRAY['won'::public.rfq_result, 'lost'::public.rfq_result]))), 0))::numeric), 2) AS win_rate_pct,
    COALESCE(sum(purchase_price_vnd) FILTER (WHERE (result = 'won'::public.rfq_result)), (0)::numeric) AS total_won_value_vnd,
    now() AS refreshed_at
   FROM public.bqms_rfq
  WHERE (inquiry_date >= (CURRENT_DATE - '30 days'::interval))
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW bqms_kpi; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.bqms_kpi IS 'KPI BQMS 30 ngay — ty le trung, doanh thu';


--
-- Name: bqms_manufacturing_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_manufacturing_daily (
    id bigint NOT NULL,
    schedule_id bigint NOT NULL,
    delivery_date date NOT NULL,
    quantity numeric(12,3) DEFAULT 0 NOT NULL,
    notes text
);


--
-- Name: TABLE bqms_manufacturing_daily; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_manufacturing_daily IS 'Chi tiet san xuat hang ngay — theo lich san xuat';


--
-- Name: bqms_manufacturing_daily_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_manufacturing_daily_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_manufacturing_daily_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_manufacturing_daily_id_seq OWNED BY public.bqms_manufacturing_daily.id;


--
-- Name: bqms_manufacturing_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_manufacturing_schedule (
    id bigint NOT NULL,
    product_id bigint,
    bqms_code text,
    specification text,
    total_qty numeric(12,3),
    schedule_month date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE bqms_manufacturing_schedule; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_manufacturing_schedule IS 'Lich san xuat BQMS theo thang';


--
-- Name: bqms_manufacturing_schedule_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_manufacturing_schedule_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_manufacturing_schedule_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_manufacturing_schedule_id_seq OWNED BY public.bqms_manufacturing_schedule.id;


--
-- Name: bqms_material_pricing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_material_pricing (
    id bigint NOT NULL,
    rfq_number text,
    product_id bigint,
    bqms_code text,
    specification text,
    unit_price_vnd numeric(15,2),
    weight_kg numeric(10,4),
    dimension_l numeric(10,3),
    dimension_w numeric(10,3),
    dimension_h numeric(10,3),
    material_type text,
    density_g_m3 numeric(10,4),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    synced_at timestamp with time zone
);


--
-- Name: TABLE bqms_material_pricing; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_material_pricing IS 'Gia vat lieu BQMS — tinh theo trong luong/kich thuoc';


--
-- Name: bqms_material_pricing_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_material_pricing_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_material_pricing_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_material_pricing_id_seq OWNED BY public.bqms_material_pricing.id;


--
-- Name: bqms_monthly_po_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_monthly_po_summary (
    id bigint NOT NULL,
    month_year date NOT NULL,
    order_count integer,
    total_amount numeric(15,2),
    currency public.currency_code DEFAULT 'VND'::public.currency_code,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE bqms_monthly_po_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_monthly_po_summary IS 'Tong hop PO BQMS hang thang';


--
-- Name: bqms_monthly_po_summary_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_monthly_po_summary_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_monthly_po_summary_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_monthly_po_summary_id_seq OWNED BY public.bqms_monthly_po_summary.id;


--
-- Name: bqms_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_orders (
    id bigint NOT NULL,
    rfq_id bigint,
    rfq_number text,
    product_id bigint,
    bqms_code text,
    specification text,
    customer_id bigint,
    customer_name text,
    expected_qty numeric(12,3),
    order_qty numeric(12,3),
    unit text DEFAULT 'EA'::text,
    order_date date,
    validity_date date,
    status text DEFAULT 'pending'::text NOT NULL,
    delivered_qty numeric(12,3) DEFAULT 0,
    delivery_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    synced_at timestamp with time zone,
    data_source text,
    CONSTRAINT bqms_orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'in_production'::text, 'shipped'::text, 'delivered'::text, 'closed'::text, 'cancelled'::text])))
);


--
-- Name: TABLE bqms_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_orders IS 'Don hang BQMS — tu dat den giao';


--
-- Name: bqms_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_orders_id_seq OWNED BY public.bqms_orders.id;


--
-- Name: bqms_qt_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_qt_events (
    id bigint NOT NULL,
    rfq_number text NOT NULL,
    bqms_code text,
    event_type text NOT NULL,
    from_state public.bqms_qt_state,
    to_state public.bqms_qt_state,
    round_no integer,
    deadline_dt timestamp with time zone,
    actor text,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE bqms_qt_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_qt_events IS 'Append-only QT lifecycle event log. Timeline "V1→V2→V3" + state transitions queried from here.';


--
-- Name: bqms_qt_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_qt_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_qt_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_qt_events_id_seq OWNED BY public.bqms_qt_events.id;


--
-- Name: bqms_quotation_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_quotation_items (
    id bigint NOT NULL,
    submission_id bigint NOT NULL,
    line_number smallint NOT NULL,
    product_id bigint,
    bqms_code text,
    specification text,
    material_type text,
    material_spec text,
    material_qty numeric(12,3),
    material_unit_price numeric(15,4),
    material_cost numeric(15,2),
    process_costs jsonb DEFAULT '{}'::jsonb NOT NULL,
    quantity numeric(12,3) NOT NULL,
    unit text DEFAULT 'EA'::text,
    unit_price numeric(15,4) NOT NULL,
    currency public.currency_code DEFAULT 'VND'::public.currency_code,
    amount numeric(15,2),
    profit_margin_pct numeric(5,2),
    total_cost numeric(15,2),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE bqms_quotation_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_quotation_items IS 'Chi tiet dong bao gia BQMS — vat lieu + gia cong';


--
-- Name: bqms_quotation_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_quotation_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_quotation_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_quotation_items_id_seq OWNED BY public.bqms_quotation_items.id;


--
-- Name: bqms_quote_batch_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_quote_batch_items (
    id integer NOT NULL,
    batch_id integer NOT NULL,
    staging_id integer NOT NULL,
    rfq_number text,
    status text DEFAULT 'pending'::text NOT NULL,
    items_count integer,
    files_count integer,
    images_count integer,
    upserts_count integer,
    classification text,
    error_message text,
    procrastinate_job_id bigint,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bqms_quote_batch_items_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'error'::text])))
);


--
-- Name: TABLE bqms_quote_batch_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_quote_batch_items IS 'Từng RFQ trong batch — worker (sc-worker) cập nhật khi /quote chạy xong';


--
-- Name: bqms_quote_batch_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_quote_batch_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_quote_batch_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_quote_batch_items_id_seq OWNED BY public.bqms_quote_batch_items.id;


--
-- Name: bqms_quote_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_quote_batches (
    id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    total_count integer DEFAULT 0 NOT NULL,
    pending_count integer DEFAULT 0 NOT NULL,
    running_count integer DEFAULT 0 NOT NULL,
    done_count integer DEFAULT 0 NOT NULL,
    error_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT bqms_quote_batches_status_check CHECK ((status = ANY (ARRAY['running'::text, 'done'::text, 'partial'::text, 'error'::text])))
);


--
-- Name: TABLE bqms_quote_batches; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_quote_batches IS 'Một lượt nhấn "Báo nhiều RFQ" — gom N row staging vào batch';


--
-- Name: bqms_quote_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_quote_batches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_quote_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_quote_batches_id_seq OWNED BY public.bqms_quote_batches.id;


--
-- Name: bqms_quote_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_quote_log (
    id bigint NOT NULL,
    rfq_id integer NOT NULL,
    round smallint NOT NULL,
    quoted_price numeric(14,4),
    quoted_currency character varying(8) DEFAULT 'USD'::character varying,
    item_type character varying(2),
    quoted_by uuid,
    quoted_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bqms_quote_log_item_type_check CHECK (((item_type)::text = ANY ((ARRAY['TM'::character varying, 'GC'::character varying])::text[]))),
    CONSTRAINT bqms_quote_log_round_check CHECK (((round >= 1) AND (round <= 4)))
);


--
-- Name: bqms_quote_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_quote_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_quote_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_quote_log_id_seq OWNED BY public.bqms_quote_log.id;


--
-- Name: bqms_raw_material_po; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_raw_material_po (
    id bigint NOT NULL,
    po_date date,
    po_number text,
    product_id bigint,
    bqms_code text,
    specification text,
    po_qty numeric(12,3),
    unit text DEFAULT 'EA'::text,
    in_stock boolean DEFAULT false,
    remaining_qty numeric(12,3) DEFAULT 0,
    delivered_qty numeric(12,3) DEFAULT 0,
    pending boolean DEFAULT true,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    synced_at timestamp with time zone
);


--
-- Name: TABLE bqms_raw_material_po; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_raw_material_po IS 'PO nguyen lieu BQMS — theo doi ton kho nguyen lieu';


--
-- Name: bqms_raw_material_po_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_raw_material_po_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_raw_material_po_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_raw_material_po_id_seq OWNED BY public.bqms_raw_material_po.id;


--
-- Name: bqms_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_records (
    id bigint NOT NULL,
    po_no text NOT NULL,
    req_no text,
    rfq_submission_id bigint,
    samsung_po_id bigint,
    item_code text,
    specification text,
    manufacturer text,
    receiver_name text,
    req_delivery_date date,
    po_qty integer,
    secure_key text,
    pdf_path text,
    raw_data jsonb,
    sync_status text DEFAULT 'pending'::text NOT NULL,
    synced_at timestamp with time zone,
    processed_at timestamp with time zone,
    CONSTRAINT bqms_records_sync_status_check CHECK ((sync_status = ANY (ARRAY['pending'::text, 'processed'::text, 'error'::text])))
);


--
-- Name: TABLE bqms_records; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_records IS 'Ban ghi PO BQMS goc — du lieu tho tu Samsung';


--
-- Name: bqms_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_records_id_seq OWNED BY public.bqms_records.id;


--
-- Name: bqms_rfq_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_rfq_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_rfq_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_rfq_id_seq OWNED BY public.bqms_rfq.id;


--
-- Name: bqms_rfq_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_rfq_submissions (
    id bigint NOT NULL,
    company_id bigint,
    rfq_number text NOT NULL,
    req_no text,
    submission_date date NOT NULL,
    deadline date,
    customer_id bigint,
    vendor_name text,
    vendor_tax_code text,
    vendor_address text,
    status public.quotation_status DEFAULT 'draft'::public.quotation_status NOT NULL,
    items_count smallint,
    pdf_path text,
    excel_cam_ket text,
    excel_commercial text,
    workflow_id bigint,
    submitted_by uuid,
    approved_by uuid,
    submitted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE bqms_rfq_submissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_rfq_submissions IS 'Nop bao gia BQMS — PDF + Excel cam ket + thuong mai';


--
-- Name: bqms_rfq_submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_rfq_submissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_rfq_submissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_rfq_submissions_id_seq OWNED BY public.bqms_rfq_submissions.id;


--
-- Name: bqms_row_gaps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_row_gaps (
    id bigint NOT NULL,
    rfq_number text NOT NULL,
    rfq_id bigint,
    staging_id bigint,
    gap_type text NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    last_attempt_at timestamp with time zone,
    drill_attempts integer DEFAULT 0 NOT NULL,
    healed_at timestamp with time zone,
    last_error text,
    CONSTRAINT bqms_row_gaps_gap_type_chk CHECK ((gap_type = ANY (ARRAY['d1_metadata_null'::text, 'd2_items_mismatch'::text, 'd3_folder_missing'::text, 'd4_subfolder_missing'::text, 'd5_all_image_tiers_empty'::text, 'd6_override_stale'::text, 'd7_folder_name_legacy'::text, 'd8_orphan_folder_old'::text, 'd9_item_type_null'::text, 'd10_orphan_image'::text])))
);


--
-- Name: TABLE bqms_row_gaps; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_row_gaps IS 'Smart Code-Track audit ledger — one row per (rfq,gap_type) detection. healed_at=NULL means still open.';


--
-- Name: COLUMN bqms_row_gaps.gap_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_row_gaps.gap_type IS '10 known kinds — see app/services/bqms_gap_detector.py GAP_TYPES.';


--
-- Name: COLUMN bqms_row_gaps.evidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_row_gaps.evidence IS 'JSONB free-form: {field:..., null_count:..., file:..., suggested_match:...}';


--
-- Name: bqms_row_gaps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_row_gaps_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_row_gaps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_row_gaps_id_seq OWNED BY public.bqms_row_gaps.id;


--
-- Name: bqms_samsung_po; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_samsung_po (
    id bigint NOT NULL,
    po_date date,
    po_number text NOT NULL,
    po_seq text,
    request_no text,
    request_seq text,
    process_status public.samsung_po_process_status DEFAULT 'new'::public.samsung_po_process_status NOT NULL,
    confirm_status text,
    pcr_flag text,
    close_po boolean DEFAULT false,
    vendor_code text,
    buyer_name text,
    buyer_email text,
    company text,
    plant text,
    product_id bigint,
    specification text,
    maker text,
    part_no text,
    bqms_code text,
    old_item_code text,
    cis_code text,
    category text,
    order_qty numeric(12,3),
    unit_price numeric(15,4),
    amount numeric(15,2),
    currency public.currency_code DEFAULT 'VND'::public.currency_code,
    recipient_name text,
    delivery_address text,
    preferred_delivery_date date,
    shipping_qty numeric(12,3),
    gr_qty numeric(12,3),
    invoice_qty numeric(12,3),
    remark text,
    shipping_type text,
    confirmed_at timestamp with time zone,
    shipped_at timestamp with time zone,
    received_at timestamp with time zone,
    invoiced_at timestamp with time zone,
    raw_data jsonb,
    synced_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    quantity integer,
    unit text DEFAULT 'EA'::text,
    secure_key text,
    rfq_id integer,
    won_by uuid,
    won_margin_pct numeric(6,3)
);


--
-- Name: TABLE bqms_samsung_po; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_samsung_po IS 'PO tu Samsung — dong bo tu BQMS, luu raw_data goc';


--
-- Name: bqms_samsung_po_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_samsung_po_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_samsung_po_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_samsung_po_id_seq OWNED BY public.bqms_samsung_po.id;


--
-- Name: bqms_scrape_presence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_scrape_presence (
    id bigint NOT NULL,
    scrape_run_id text,
    rfq_number text NOT NULL,
    bqms_code text,
    is_active boolean DEFAULT true NOT NULL,
    samsung_round integer,
    deadline_dt timestamp with time zone,
    raw_status text,
    seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE bqms_scrape_presence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_scrape_presence IS 'Append-only presence ledger — 1 row per (scrape_run, rfq, code). Drives deterministic re-invite detection.';


--
-- Name: bqms_scrape_presence_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_scrape_presence_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_scrape_presence_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_scrape_presence_id_seq OWNED BY public.bqms_scrape_presence.id;


--
-- Name: bqms_vendor_portal_staging; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_vendor_portal_staging (
    id bigint NOT NULL,
    scraped_at timestamp with time zone DEFAULT now() NOT NULL,
    scrape_run_id uuid NOT NULL,
    module text NOT NULL,
    rfq_number text,
    contract_no text,
    contract_period text,
    item_code text,
    description text,
    specification text,
    quantity numeric,
    unit text,
    raw_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending_review'::text NOT NULL,
    review_notes text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    merged_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE bqms_vendor_portal_staging; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_vendor_portal_staging IS 'Raw scrape output from sec-bqms.com vendor portal — human-reviewed before merge.';


--
-- Name: COLUMN bqms_vendor_portal_staging.module; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_vendor_portal_staging.module IS 'Source area: contract | po | bidding';


--
-- Name: COLUMN bqms_vendor_portal_staging.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bqms_vendor_portal_staging.status IS 'pending_review (default after scrape) | approved | rejected | merged';


--
-- Name: bqms_vendor_portal_staging_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_vendor_portal_staging_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_vendor_portal_staging_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_vendor_portal_staging_id_seq OWNED BY public.bqms_vendor_portal_staging.id;


--
-- Name: bqms_won_quotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bqms_won_quotations (
    id bigint NOT NULL,
    rfq_id bigint,
    rfq_number text,
    bqms_code text,
    product_id bigint,
    person_in_charge_name text,
    description text,
    specification text,
    quantity numeric(12,3),
    unit text DEFAULT 'EA'::text,
    po_price numeric(15,4),
    po_deadline date,
    supplier_name text,
    hs_code text,
    hs_code_id bigint,
    goods_description text,
    customs_char_count integer,
    leadtime_days smallint,
    delivery_location text,
    invoice_issued boolean DEFAULT false,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    synced_at timestamp with time zone
);


--
-- Name: TABLE bqms_won_quotations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bqms_won_quotations IS 'Bao gia BQMS da trung thau';


--
-- Name: bqms_won_quotations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bqms_won_quotations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bqms_won_quotations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bqms_won_quotations_id_seq OWNED BY public.bqms_won_quotations.id;


--
-- Name: budget_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_targets (
    id bigint NOT NULL,
    fiscal_year smallint NOT NULL,
    fiscal_month smallint,
    target_type text NOT NULL,
    business_system public.business_system,
    customer_id bigint,
    department text,
    target_value numeric(18,2) NOT NULL,
    actual_value numeric(18,2),
    currency public.currency_code DEFAULT 'VND'::public.currency_code,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE budget_targets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.budget_targets IS 'Muc tieu ngan sach — ke hoach vs thuc te';


--
-- Name: budget_targets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.budget_targets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: budget_targets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.budget_targets_id_seq OWNED BY public.budget_targets.id;


--
-- Name: calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_events (
    id bigint NOT NULL,
    title text NOT NULL,
    description text,
    event_type text NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone,
    all_day boolean DEFAULT false,
    location text,
    attendees uuid[] DEFAULT '{}'::uuid[],
    ref_type text,
    ref_id bigint,
    color text DEFAULT '#3b82f6'::text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_events_event_type_check CHECK ((event_type = ANY (ARRAY['meeting'::text, 'deadline'::text, 'holiday'::text, 'leave'::text, 'delivery'::text, 'other'::text])))
);


--
-- Name: calendar_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.calendar_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: calendar_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.calendar_events_id_seq OWNED BY public.calendar_events.id;


--
-- Name: cash_book; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_book (
    id bigint NOT NULL,
    company_id bigint,
    entry_date date NOT NULL,
    document_number text,
    category_id bigint,
    counterparty text,
    description text NOT NULL,
    amount numeric(15,2) NOT NULL,
    direction text NOT NULL,
    balance_after numeric(15,2),
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cash_book_direction_check CHECK ((direction = ANY (ARRAY['thu'::text, 'chi'::text, 'income'::text, 'expense'::text, 'transfer'::text])))
);


--
-- Name: TABLE cash_book; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cash_book IS 'So quy tien mat — ghi nhan thu/chi hang ngay';


--
-- Name: cash_book_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_book_categories (
    id bigint NOT NULL,
    category_code text NOT NULL,
    category_name text NOT NULL,
    direction text NOT NULL,
    parent_id bigint,
    sort_order smallint,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cash_book_categories_direction_check CHECK ((direction = ANY (ARRAY['thu'::text, 'chi'::text, 'both'::text])))
);


--
-- Name: TABLE cash_book_categories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cash_book_categories IS 'Danh muc so quy — phan loai thu/chi';


--
-- Name: cash_book_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cash_book_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cash_book_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cash_book_categories_id_seq OWNED BY public.cash_book_categories.id;


--
-- Name: cash_book_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cash_book_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cash_book_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cash_book_id_seq OWNED BY public.cash_book.id;


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id bigint NOT NULL,
    company_code text NOT NULL,
    company_name text NOT NULL,
    tax_code text,
    address text,
    representative text,
    phone text,
    email text,
    bank_name text,
    bank_account text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE companies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.companies IS 'Phap nhan cong ty — Song Chau (SC), AMA Bac Ninh (AMA)';


--
-- Name: companies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.companies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: companies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.companies_id_seq OWNED BY public.companies.id;


--
-- Name: contract_price_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_price_items (
    id bigint NOT NULL,
    contract_id bigint NOT NULL,
    product_id bigint,
    product_code text,
    tier_min_qty numeric(12,3) DEFAULT 1 NOT NULL,
    tier_max_qty numeric(12,3),
    unit_price numeric(15,4) NOT NULL,
    currency public.currency_code DEFAULT 'USD'::public.currency_code,
    moq numeric(12,3),
    lead_time_days smallint,
    valid_from date NOT NULL,
    valid_to date,
    notes text
);


--
-- Name: TABLE contract_price_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contract_price_items IS 'Gia theo hop dong — ho tro gia bac (tier pricing)';


--
-- Name: contract_price_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_price_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_price_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_price_items_id_seq OWNED BY public.contract_price_items.id;


--
-- Name: crm_account_external_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_account_external_map (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    source_system text NOT NULL,
    match_field text NOT NULL,
    match_value text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_account_external_map_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crm_account_external_map_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_account_external_map_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crm_account_external_map_id_seq OWNED BY public.crm_account_external_map.id;


--
-- Name: crm_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_contacts (
    id bigint NOT NULL,
    customer_id bigint,
    full_name text NOT NULL,
    "position" text,
    department text,
    email text,
    phone text,
    is_primary boolean DEFAULT false,
    notes text,
    last_contacted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crm_contacts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crm_contacts_id_seq OWNED BY public.crm_contacts.id;


--
-- Name: crm_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_interactions (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    contact_id bigint,
    interaction_type text NOT NULL,
    subject text NOT NULL,
    notes text,
    outcome text,
    follow_up_date date,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_interactions_interaction_type_check CHECK ((interaction_type = ANY (ARRAY['email'::text, 'call'::text, 'meeting'::text, 'visit'::text, 'other'::text, 'zalo'::text, 'note'::text, 'demo'::text, 'support'::text])))
);


--
-- Name: crm_interactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crm_interactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_interactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crm_interactions_id_seq OWNED BY public.crm_interactions.id;


--
-- Name: crm_pipeline_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_pipeline_cards (
    id bigint NOT NULL,
    stage text DEFAULT 'new'::text NOT NULL,
    title text NOT NULL,
    description text,
    customer_name text,
    customer_id bigint,
    rfq_number text,
    po_number text,
    bqms_code text,
    quotation_id bigint,
    delivery_id bigint,
    follow_up_date date,
    follow_up_note text,
    assigned_to uuid,
    assigned_name text,
    priority text DEFAULT 'normal'::text,
    source text DEFAULT 'manual'::text,
    is_archived boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    moved_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    CONSTRAINT crm_pipeline_cards_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT crm_pipeline_cards_stage_check CHECK ((stage = ANY (ARRAY['new'::text, 'nurturing'::text, 'active'::text, 'quoting'::text, 'waiting'::text, 'delivering'::text, 'aftercare'::text])))
);


--
-- Name: crm_pipeline_cards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crm_pipeline_cards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_pipeline_cards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crm_pipeline_cards_id_seq OWNED BY public.crm_pipeline_cards.id;


--
-- Name: customer_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_contacts (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    full_name text NOT NULL,
    email text,
    phone text,
    department text,
    delivery_info text,
    warehouse_code text,
    is_primary boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    synced_at timestamp with time zone
);


--
-- Name: TABLE customer_contacts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_contacts IS 'Dau moi lien he cua khach hang';


--
-- Name: customer_contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_contacts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_contacts_id_seq OWNED BY public.customer_contacts.id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id bigint NOT NULL,
    customer_code text,
    company_name text NOT NULL,
    company_name_unaccent text GENERATED ALWAYS AS (public.immutable_unaccent(lower(company_name))) STORED,
    short_name text,
    tax_code text,
    address text,
    business_system public.business_system,
    customer_type text,
    is_active boolean DEFAULT true NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    contact_name character varying(200),
    contact_role character varying(100),
    industry character varying(50),
    company_size character varying(50),
    lead_source character varying(50),
    preferred_channel character varying(20),
    website character varying(255),
    notes text,
    owner_id uuid
);


--
-- Name: TABLE customers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customers IS 'Khach hang — ho tro tim kiem khong dau qua company_name_unaccent';


--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: customs_declaration_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customs_declaration_items (
    id bigint NOT NULL,
    declaration_id bigint NOT NULL,
    line_number smallint NOT NULL,
    xnk_tracking_id bigint,
    product_id bigint,
    hs_code_id bigint,
    hs_code text NOT NULL,
    description text NOT NULL,
    country_origin text,
    quantity numeric(12,3) NOT NULL,
    unit text NOT NULL,
    unit_price_usd numeric(15,4),
    amount_usd numeric(15,2),
    import_tax_rate numeric(5,2),
    import_tax numeric(15,2),
    vat_rate numeric(5,2) DEFAULT 10,
    vat_amount numeric(15,2)
);


--
-- Name: TABLE customs_declaration_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customs_declaration_items IS 'Chi tiet dong hang tren to khai hai quan';


--
-- Name: customs_declaration_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customs_declaration_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customs_declaration_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customs_declaration_items_id_seq OWNED BY public.customs_declaration_items.id;


--
-- Name: customs_declarations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customs_declarations (
    id bigint NOT NULL,
    declaration_number text NOT NULL,
    declaration_date date NOT NULL,
    declaration_type text NOT NULL,
    customs_office text,
    importer_name text NOT NULL,
    importer_tax_code text NOT NULL,
    exporter_name text,
    country_origin text,
    port_of_loading text,
    port_of_discharge text,
    transport_mode text,
    bill_of_lading text,
    total_value_usd numeric(15,2),
    total_value_vnd numeric(18,0),
    import_tax numeric(15,2) DEFAULT 0,
    vat_amount numeric(15,2) DEFAULT 0,
    special_tax numeric(15,2) DEFAULT 0,
    total_tax numeric(15,2) DEFAULT 0,
    status text DEFAULT 'draft'::text NOT NULL,
    cleared_at timestamp with time zone,
    document_path text,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customs_declarations_declaration_type_check CHECK ((declaration_type = ANY (ARRAY['import'::text, 'export'::text]))),
    CONSTRAINT customs_declarations_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'green'::text, 'yellow'::text, 'red'::text, 'cleared'::text, 'cancelled'::text])))
);


--
-- Name: TABLE customs_declarations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customs_declarations IS 'To khai hai quan — phan luong xanh/vang/do';


--
-- Name: customs_declarations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customs_declarations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customs_declarations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customs_declarations_id_seq OWNED BY public.customs_declarations.id;


--
-- Name: data_quality_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_quality_checks (
    id bigint NOT NULL,
    table_name text NOT NULL,
    check_name text NOT NULL,
    check_type text NOT NULL,
    status text NOT NULL,
    affected_rows integer DEFAULT 0 NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT data_quality_checks_status_check CHECK ((status = ANY (ARRAY['pass'::text, 'warning'::text, 'fail'::text])))
);


--
-- Name: data_quality_checks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.data_quality_checks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: data_quality_checks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.data_quality_checks_id_seq OWNED BY public.data_quality_checks.id;


--
-- Name: deal_margins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_margins (
    id bigint NOT NULL,
    chain_code text NOT NULL,
    sales_order_id bigint,
    invoice_id bigint,
    revenue_vnd numeric(16,2) DEFAULT 0 NOT NULL,
    cogs_vnd numeric(16,2) DEFAULT 0 NOT NULL,
    freight_vnd numeric(16,2) DEFAULT 0 NOT NULL,
    customs_duty_vnd numeric(16,2) DEFAULT 0 NOT NULL,
    other_costs_vnd numeric(16,2) DEFAULT 0 NOT NULL,
    total_cost_vnd numeric(16,2) GENERATED ALWAYS AS ((((cogs_vnd + freight_vnd) + customs_duty_vnd) + other_costs_vnd)) STORED,
    gross_profit_vnd numeric(16,2) GENERATED ALWAYS AS ((revenue_vnd - (((cogs_vnd + freight_vnd) + customs_duty_vnd) + other_costs_vnd))) STORED,
    margin_pct numeric(6,3) GENERATED ALWAYS AS (
CASE
    WHEN (revenue_vnd = (0)::numeric) THEN (0)::numeric
    ELSE round((((revenue_vnd - (((cogs_vnd + freight_vnd) + customs_duty_vnd) + other_costs_vnd)) / revenue_vnd) * (100)::numeric), 3)
END) STORED,
    exchange_rate_cny numeric(10,4),
    exchange_rate_usd numeric(10,4),
    calculated_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deal_margins_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deal_margins_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deal_margins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deal_margins_id_seq OWNED BY public.deal_margins.id;


--
-- Name: delivery_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_receipts (
    id bigint NOT NULL,
    receipt_number text,
    company_id bigint,
    customer_id bigint,
    customer_name text,
    sales_order_id bigint,
    po_id bigint,
    receipt_date date NOT NULL,
    delivery_method text,
    driver_name text,
    vehicle_number text,
    receiver_name text,
    receiver_phone text,
    total_items smallint,
    notes text,
    signed_at timestamp with time zone,
    document_path text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE delivery_receipts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.delivery_receipts IS 'Phieu giao hang — ghi nhan giao cho khach';


--
-- Name: delivery_receipts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.delivery_receipts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: delivery_receipts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.delivery_receipts_id_seq OWNED BY public.delivery_receipts.id;


--
-- Name: demand_forecasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demand_forecasts (
    id bigint NOT NULL,
    product_id bigint,
    bqms_code text,
    forecast_date date NOT NULL,
    period_months integer DEFAULT 3 NOT NULL,
    predicted_qty numeric(12,2),
    confidence numeric(5,2),
    method text DEFAULT 'moving_avg'::text,
    input_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: demand_forecasts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.demand_forecasts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: demand_forecasts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.demand_forecasts_id_seq OWNED BY public.demand_forecasts.id;


--
-- Name: dim_date; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dim_date (
    date_key date NOT NULL,
    year smallint NOT NULL,
    quarter smallint NOT NULL,
    month smallint NOT NULL,
    week_of_year smallint NOT NULL,
    day_of_month smallint NOT NULL,
    day_of_week smallint NOT NULL,
    day_name text NOT NULL,
    day_name_vi text NOT NULL,
    month_name text NOT NULL,
    month_name_vi text NOT NULL,
    is_weekend boolean DEFAULT false NOT NULL,
    is_holiday boolean DEFAULT false NOT NULL,
    holiday_name text,
    is_working_day boolean DEFAULT true NOT NULL,
    fiscal_year smallint NOT NULL,
    fiscal_quarter smallint NOT NULL,
    fiscal_month smallint NOT NULL
);


--
-- Name: TABLE dim_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.dim_date IS 'Bang chieu ngay — 2020 den 2030, danh dau ngay le VN';


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id bigint NOT NULL,
    title text NOT NULL,
    description text,
    file_path text NOT NULL,
    file_name text NOT NULL,
    file_size bigint,
    mime_type text,
    category text DEFAULT 'general'::text,
    tags text[] DEFAULT '{}'::text[],
    uploaded_by uuid NOT NULL,
    is_public boolean DEFAULT false,
    version integer DEFAULT 1,
    parent_id bigint,
    ref_type text,
    ref_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.documents_id_seq OWNED BY public.documents.id;


--
-- Name: domain_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.domain_events (
    id bigint NOT NULL,
    event_type text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    chain_code text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: domain_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.domain_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: domain_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.domain_events_id_seq OWNED BY public.domain_events.id;


--
-- Name: e_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.e_invoices (
    id bigint NOT NULL,
    revenue_invoice_id bigint,
    e_invoice_number text NOT NULL,
    e_invoice_symbol text NOT NULL,
    serial_number text,
    issue_date date NOT NULL,
    tax_authority_code text,
    lookup_code text,
    signing_status text DEFAULT 'unsigned'::text NOT NULL,
    signed_at timestamp with time zone,
    sent_to_tax_at timestamp with time zone,
    tax_accepted_at timestamp with time zone,
    cancelled_reason text,
    replacement_invoice_id bigint,
    buyer_name text NOT NULL,
    buyer_tax_code text,
    buyer_address text,
    buyer_bank_account text,
    subtotal numeric(15,2) NOT NULL,
    vat_rate numeric(5,2),
    vat_amount numeric(15,2),
    total_amount numeric(15,2) NOT NULL,
    currency public.currency_code DEFAULT 'VND'::public.currency_code,
    xml_path text,
    pdf_path text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT e_invoices_signing_status_check CHECK ((signing_status = ANY (ARRAY['unsigned'::text, 'signed'::text, 'sent'::text, 'accepted'::text, 'rejected'::text, 'cancelled'::text, 'replaced'::text])))
);


--
-- Name: TABLE e_invoices; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.e_invoices IS 'Hoa don dien tu — theo quy dinh Tong cuc Thue VN';


--
-- Name: e_invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.e_invoices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: e_invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.e_invoices_id_seq OWNED BY public.e_invoices.id;


--
-- Name: email_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_history (
    id bigint NOT NULL,
    direction text NOT NULL,
    from_email text NOT NULL,
    to_email text NOT NULL,
    subject text NOT NULL,
    body_preview text,
    body_html text,
    has_attachments boolean DEFAULT false,
    attachment_names text[],
    message_id text,
    conversation_id text,
    ref_type text,
    ref_id bigint,
    is_read boolean DEFAULT false,
    received_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_history_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])))
);


--
-- Name: email_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_history_id_seq OWNED BY public.email_history.id;


--
-- Name: exchange_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exchange_rates (
    id bigint NOT NULL,
    rate_date date NOT NULL,
    from_currency public.currency_code DEFAULT 'USD'::public.currency_code NOT NULL,
    to_currency public.currency_code DEFAULT 'VND'::public.currency_code NOT NULL,
    rate numeric(15,4) NOT NULL,
    rate_type text DEFAULT 'transfer'::text NOT NULL,
    source text DEFAULT 'manual'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    CONSTRAINT exchange_rates_rate_type_check CHECK ((rate_type = ANY (ARRAY['cash_buy'::text, 'transfer'::text, 'sell'::text])))
);


--
-- Name: TABLE exchange_rates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.exchange_rates IS 'Ty gia hoi doai hang ngay — VND, USD, RMB, KRW, JPY, EUR';


--
-- Name: leave_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_requests (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    leave_type text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    days_count numeric(4,1) NOT NULL,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    department text,
    rejected_by uuid,
    rejected_at timestamp with time zone,
    cancelled_by uuid,
    cancelled_at timestamp with time zone,
    decision_note text,
    half_day_start boolean DEFAULT false NOT NULL,
    half_day_end boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_lr_dates CHECK ((start_date <= end_date)),
    CONSTRAINT chk_lr_days_count CHECK (((days_count > (0)::numeric) AND (days_count = (round((days_count * (2)::numeric)) / (2)::numeric)))),
    CONSTRAINT leave_requests_leave_type_check CHECK ((leave_type = ANY (ARRAY['annual'::text, 'sick'::text, 'personal'::text, 'maternity'::text, 'other'::text]))),
    CONSTRAINT leave_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])))
);


--
-- Name: public_holidays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_holidays (
    id bigint NOT NULL,
    holiday_date date NOT NULL,
    name text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE public_holidays; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.public_holidays IS 'M45 — Danh mục ngày lễ VN dùng để trừ khỏi employee_monthly_kpi.workdays_present. is_active=false để "tắt" 1 ngày mà không xoá lịch sử. Admin seed/sửa tay qua SQL (chưa có UI quản trị riêng).';


--
-- Name: COLUMN public_holidays.holiday_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.public_holidays.holiday_date IS 'Ngày dương lịch. Chỉ ngày rơi vào Thứ 2-6 (ISODOW 1-5) mới được trừ khỏi workdays_present — ngày lễ rơi T7/CN không trừ thêm (vốn đã không tính là ngày công).';


--
-- Name: revenue_chain; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revenue_chain (
    id bigint NOT NULL,
    chain_code text NOT NULL,
    rfq_id bigint,
    sales_order_id bigint,
    supplier_quote_id bigint,
    po_id bigint,
    shipment_id bigint,
    invoice_id bigint,
    ar_id bigint,
    ap_id bigint,
    rfq_status text,
    so_status text,
    quote_status text,
    po_status text,
    shipment_status text,
    invoice_status text,
    payment_status text,
    current_stage text DEFAULT 'rfq'::text NOT NULL,
    is_complete boolean DEFAULT false NOT NULL,
    completed_at timestamp with time zone,
    revenue_vnd numeric(16,2),
    cogs_vnd numeric(16,2),
    margin_pct numeric(6,3),
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT revenue_chain_current_stage_check CHECK ((current_stage = ANY (ARRAY['rfq'::text, 'quotation'::text, 'so'::text, 'supplier_quote'::text, 'po'::text, 'shipment'::text, 'invoice'::text, 'payment'::text, 'completed'::text])))
);


--
-- Name: sales_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_orders (
    id bigint NOT NULL,
    order_number text,
    company_id bigint,
    customer_id bigint NOT NULL,
    customer_name text,
    order_date date NOT NULL,
    requested_delivery_date date,
    status text DEFAULT 'draft'::text NOT NULL,
    subtotal numeric(15,2) DEFAULT 0,
    vat_amount numeric(15,2) DEFAULT 0,
    total_amount numeric(15,2) DEFAULT 0,
    currency public.currency_code DEFAULT 'VND'::public.currency_code,
    advance_payment numeric(15,2) DEFAULT 0,
    remaining_payment numeric(15,2) DEFAULT 0,
    delivered_date date,
    invoice_number text,
    invoice_date date,
    source_system text,
    source_ref text,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    rfq_id bigint,
    chain_code text,
    CONSTRAINT sales_orders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'in_progress'::text, 'shipped'::text, 'delivered'::text, 'invoiced'::text, 'closed'::text, 'cancelled'::text])))
);


--
-- Name: TABLE sales_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sales_orders IS 'Don ban hang — tu dong tao so SO-YYYYMM-XXXXXX';


--
-- Name: user_activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_activity_log (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    page text,
    entity_type text,
    entity_id bigint,
    metadata jsonb DEFAULT '{}'::jsonb,
    session_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email text NOT NULL,
    full_name text NOT NULL,
    display_name text,
    role public.role_enum DEFAULT 'staff'::public.role_enum NOT NULL,
    department text,
    phone text,
    hashed_password text NOT NULL,
    m365_id text,
    is_active boolean DEFAULT true NOT NULL,
    deleted_at timestamp with time zone,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    password_version integer DEFAULT 1 NOT NULL
);


--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.users IS 'Nguoi dung he thong — 18 nhan vien, 6 roles';


--
-- Name: COLUMN users.m365_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.m365_id IS 'Microsoft 365 account ID cho SSO';


--
-- Name: COLUMN users.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.deleted_at IS 'NULL = active, co gia tri = da xoa mem';


--
-- Name: COLUMN users.password_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.password_version IS 'Bump +1 on every password change/reset to revoke all old JWTs (claim pv validated every request at conn-bearing chokepoints).';


--
-- Name: employee_current_month_kpi; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.employee_current_month_kpi AS
 WITH bounds AS (
         SELECT (date_trunc('month'::text, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'::text)))::date AS d_start,
            ((date_trunc('month'::text, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'::text)) + '1 mon'::interval))::date AS d_end_excl,
            (EXTRACT(year FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'::text)))::smallint AS y,
            (EXTRACT(month FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'::text)))::smallint AS m
        ), weekdays_in_month AS (
         SELECT b_1.y,
            b_1.m,
            (count(*))::integer AS wd
           FROM bounds b_1,
            LATERAL generate_series((b_1.d_start)::timestamp without time zone, (b_1.d_end_excl - '1 day'::interval), '1 day'::interval) d(d)
          WHERE (EXTRACT(isodow FROM d.d) < (6)::numeric)
          GROUP BY b_1.y, b_1.m
        ), holidays_in_month AS (
         SELECT b_1.y,
            b_1.m,
            (count(*))::integer AS hd
           FROM (bounds b_1
             JOIN public.public_holidays ph ON (((ph.holiday_date >= b_1.d_start) AND (ph.holiday_date < b_1.d_end_excl) AND (ph.is_active = true))))
          WHERE (EXTRACT(isodow FROM ph.holiday_date) < (6)::numeric)
          GROUP BY b_1.y, b_1.m
        ), revenue AS (
         SELECT so.created_by AS user_id,
            sum((so.total_amount *
                CASE
                    WHEN (so.currency = 'VND'::public.currency_code) THEN (1)::numeric
                    ELSE COALESCE(fx.rate, (0)::numeric)
                END)) AS revenue_vnd,
            count(*) AS orders_count
           FROM ((public.sales_orders so
             CROSS JOIN bounds b_1)
             LEFT JOIN LATERAL ( SELECT er.rate
                   FROM public.exchange_rates er
                  WHERE ((er.from_currency = so.currency) AND (er.to_currency = 'VND'::public.currency_code) AND (er.rate_date <= (so.created_at)::date))
                  ORDER BY er.rate_date DESC, (er.rate_type = 'transfer'::text) DESC
                 LIMIT 1) fx ON ((so.currency <> 'VND'::public.currency_code)))
          WHERE ((so.created_at >= b_1.d_start) AND (so.created_at < b_1.d_end_excl) AND (so.status <> ALL (ARRAY['draft'::text, 'cancelled'::text])))
          GROUP BY so.created_by
        ), new_cust AS (
         SELECT al.user_id,
            (count(*))::integer AS n
           FROM public.audit_log al,
            bounds b_1
          WHERE ((al.table_name = 'customers'::text) AND (al.action = 'INSERT'::text) AND (al.created_at >= b_1.d_start) AND (al.created_at < b_1.d_end_excl) AND (al.user_id IS NOT NULL))
          GROUP BY al.user_id
        ), new_prod AS (
         SELECT al.user_id,
            (count(*))::integer AS n
           FROM public.audit_log al,
            bounds b_1
          WHERE ((al.table_name = 'products'::text) AND (al.action = 'INSERT'::text) AND (al.created_at >= b_1.d_start) AND (al.created_at < b_1.d_end_excl) AND (al.user_id IS NOT NULL))
          GROUP BY al.user_id
        ), new_supp_codes AS (
         SELECT al.user_id,
            (count(*))::integer AS n
           FROM public.audit_log al,
            bounds b_1
          WHERE ((al.table_name = 'supplier_product_map'::text) AND (al.action = 'INSERT'::text) AND (al.created_at >= b_1.d_start) AND (al.created_at < b_1.d_end_excl) AND (al.user_id IS NOT NULL))
          GROUP BY al.user_id
        ), quotes_sent_cte AS (
         SELECT q.quoted_by AS user_id,
            (count(*))::integer AS n
           FROM public.bqms_quote_log q,
            bounds b_1
          WHERE ((q.quoted_at >= b_1.d_start) AND (q.quoted_at < b_1.d_end_excl) AND (q.quoted_by IS NOT NULL))
          GROUP BY q.quoted_by
        ), quotes_won_cte AS (
         SELECT po.won_by AS user_id,
            (count(*))::integer AS n
           FROM public.bqms_samsung_po po,
            bounds b_1
          WHERE ((po.created_at >= b_1.d_start) AND (po.created_at < b_1.d_end_excl) AND (po.won_by IS NOT NULL))
          GROUP BY po.won_by
        ), deals_closed_cte AS (
         SELECT rc.created_by AS user_id,
            (count(*))::integer AS n
           FROM public.revenue_chain rc,
            bounds b_1
          WHERE ((rc.is_complete = true) AND (rc.completed_at >= b_1.d_start) AND (rc.completed_at < b_1.d_end_excl) AND (rc.created_by IS NOT NULL))
          GROUP BY rc.created_by
        ), daily_reports AS (
         SELECT r_1.result_updated_by AS user_id,
            (count(DISTINCT date((r_1.updated_at AT TIME ZONE 'Asia/Ho_Chi_Minh'::text))))::integer AS n
           FROM public.bqms_rfq r_1,
            bounds b_1
          WHERE ((r_1.report IS NOT NULL) AND (r_1.report ~~* 'Báo cáo %'::text) AND (r_1.updated_at >= b_1.d_start) AND (r_1.updated_at < b_1.d_end_excl) AND (r_1.result_updated_by IS NOT NULL))
          GROUP BY r_1.result_updated_by
        ), leave_days AS (
         SELECT lr.user_id,
            (sum((((( SELECT count(*) AS count
                   FROM generate_series((GREATEST(lr.start_date, b_1.d_start))::timestamp without time zone, LEAST((lr.end_date)::timestamp without time zone, (b_1.d_end_excl - '1 day'::interval)), '1 day'::interval) d(d)
                  WHERE (EXTRACT(isodow FROM d.d) < (6)::numeric)))::numeric -
                CASE
                    WHEN (lr.half_day_start AND (lr.start_date >= b_1.d_start)) THEN 0.5
                    ELSE (0)::numeric
                END) -
                CASE
                    WHEN (lr.half_day_end AND (lr.end_date < b_1.d_end_excl)) THEN 0.5
                    ELSE (0)::numeric
                END)))::numeric(4,1) AS days
           FROM public.leave_requests lr,
            bounds b_1
          WHERE ((lr.status = 'approved'::text) AND (lr.start_date < b_1.d_end_excl) AND (lr.end_date >= b_1.d_start))
          GROUP BY lr.user_id
        ), activity AS (
         SELECT ual.user_id,
            (count(DISTINCT date((ual.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'::text))))::integer AS active_days,
            (count(*))::integer AS total_actions
           FROM public.user_activity_log ual,
            bounds b_1
          WHERE ((ual.created_at >= b_1.d_start) AND (ual.created_at < b_1.d_end_excl))
          GROUP BY ual.user_id
        ), late_cte AS (
         SELECT ai.user_id,
            (count(*) FILTER (WHERE (ai.incident_type = 'late'::text)))::integer AS late_count,
            (COALESCE(sum(ai.minutes_off) FILTER (WHERE (ai.incident_type = 'late'::text)), (0)::bigint))::integer AS total_late_minutes
           FROM public.attendance_incidents ai,
            bounds b_1
          WHERE ((ai.incident_date >= b_1.d_start) AND (ai.incident_date < b_1.d_end_excl))
          GROUP BY ai.user_id
        )
 SELECT u.id AS user_id,
    u.department,
    b.y AS period_year,
    b.m AS period_month,
    ((b.y * 100) + b.m) AS period_key,
    (COALESCE(r.revenue_vnd, (0)::numeric))::numeric(18,2) AS revenue_vnd,
    (COALESCE(r.orders_count, (0)::bigint))::integer AS orders_count,
        CASE
            WHEN (COALESCE(r.orders_count, (0)::bigint) > 0) THEN ((r.revenue_vnd / (r.orders_count)::numeric))::numeric(18,2)
            ELSE (0)::numeric(18,2)
        END AS avg_order_value,
    COALESCE(nc.n, 0) AS new_customers,
    COALESCE(np.n, 0) AS new_products,
    COALESCE(nsc.n, 0) AS new_supplier_codes,
    COALESCE(qs.n, 0) AS quotes_sent,
    COALESCE(qw.n, 0) AS quotes_won,
    COALESCE(dc.n, 0) AS deals_closed,
    COALESCE(dr.n, 0) AS daily_reports_submitted,
    (COALESCE(ld.days, (0)::numeric))::numeric(4,1) AS leave_days_taken,
    COALESCE(act.active_days, 0) AS active_days,
    COALESCE(act.total_actions, 0) AS total_actions,
    GREATEST(0, ((wd.wd - COALESCE(hd.hd, 0)) - (COALESCE(ld.days, (0)::numeric))::integer)) AS workdays_present,
    COALESCE(lc.late_count, 0) AS late_count,
    COALESCE(lc.total_late_minutes, 0) AS total_late_minutes,
    now() AS computed_at,
    false AS is_final
   FROM ((((((((((((((public.users u
     CROSS JOIN bounds b)
     CROSS JOIN weekdays_in_month wd)
     LEFT JOIN holidays_in_month hd ON (((hd.y = b.y) AND (hd.m = b.m))))
     LEFT JOIN revenue r ON ((r.user_id = u.id)))
     LEFT JOIN new_cust nc ON ((nc.user_id = u.id)))
     LEFT JOIN new_prod np ON ((np.user_id = u.id)))
     LEFT JOIN new_supp_codes nsc ON ((nsc.user_id = u.id)))
     LEFT JOIN quotes_sent_cte qs ON ((qs.user_id = u.id)))
     LEFT JOIN quotes_won_cte qw ON ((qw.user_id = u.id)))
     LEFT JOIN deals_closed_cte dc ON ((dc.user_id = u.id)))
     LEFT JOIN daily_reports dr ON ((dr.user_id = u.id)))
     LEFT JOIN leave_days ld ON ((ld.user_id = u.id)))
     LEFT JOIN activity act ON ((act.user_id = u.id)))
     LEFT JOIN late_cte lc ON ((lc.user_id = u.id)))
  WHERE ((u.deleted_at IS NULL) AND (u.is_active = true));


--
-- Name: employee_monthly_kpi; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_monthly_kpi (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    department text,
    period_year smallint NOT NULL,
    period_month smallint NOT NULL,
    period_key integer GENERATED ALWAYS AS (((period_year * 100) + period_month)) STORED,
    revenue_vnd numeric(18,2) DEFAULT 0 NOT NULL,
    orders_count integer DEFAULT 0 NOT NULL,
    avg_order_value numeric(18,2) DEFAULT 0 NOT NULL,
    new_customers integer DEFAULT 0 NOT NULL,
    new_products integer DEFAULT 0 NOT NULL,
    new_supplier_codes integer DEFAULT 0 NOT NULL,
    quotes_sent integer DEFAULT 0 NOT NULL,
    quotes_won integer DEFAULT 0 NOT NULL,
    deals_closed integer DEFAULT 0 NOT NULL,
    daily_reports_submitted integer DEFAULT 0 NOT NULL,
    leave_days_taken numeric(4,1) DEFAULT 0 NOT NULL,
    active_days integer DEFAULT 0 NOT NULL,
    total_actions integer DEFAULT 0 NOT NULL,
    workdays_present integer DEFAULT 0 NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    is_final boolean DEFAULT false NOT NULL,
    late_count integer DEFAULT 0 NOT NULL,
    total_late_minutes integer DEFAULT 0 NOT NULL,
    CONSTRAINT employee_monthly_kpi_period_month_check CHECK (((period_month >= 1) AND (period_month <= 12))),
    CONSTRAINT employee_monthly_kpi_period_year_check CHECK (((period_year >= 2024) AND (period_year <= 2099)))
);


--
-- Name: TABLE employee_monthly_kpi; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.employee_monthly_kpi IS 'M40 — KPI tháng cho từng nhân viên. UPSERT bởi app.tasks.kpi_aggregator.';


--
-- Name: COLUMN employee_monthly_kpi.department; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employee_monthly_kpi.department IS 'Snapshot department tại thời điểm tính (nhân viên có thể đổi phòng giữa tháng).';


--
-- Name: COLUMN employee_monthly_kpi.workdays_present; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employee_monthly_kpi.workdays_present IS 'Mon-Fri trong tháng - ngày lễ (public_holidays, M45) - leave_days_taken.';


--
-- Name: COLUMN employee_monthly_kpi.is_final; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employee_monthly_kpi.is_final IS 'true = tháng đã đóng và aggregator đã chạy. false = view động hoặc đang tính.';


--
-- Name: employee_monthly_kpi_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_monthly_kpi_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_monthly_kpi_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_monthly_kpi_id_seq OWNED BY public.employee_monthly_kpi.id;


--
-- Name: error_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.error_log (
    id bigint NOT NULL,
    error_type text NOT NULL,
    severity text DEFAULT 'error'::text NOT NULL,
    message text NOT NULL,
    stack_trace text,
    endpoint text,
    user_id uuid,
    request_data jsonb,
    resolved boolean DEFAULT false NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT error_log_severity_check CHECK ((severity = ANY (ARRAY['warning'::text, 'error'::text, 'critical'::text])))
);


--
-- Name: error_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.error_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: error_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.error_log_id_seq OWNED BY public.error_log.id;


--
-- Name: etl_sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.etl_sync_log (
    id bigint NOT NULL,
    sync_type text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    status text DEFAULT 'running'::text NOT NULL,
    files_processed integer DEFAULT 0,
    rows_inserted integer DEFAULT 0,
    rows_updated integer DEFAULT 0,
    rows_skipped integer DEFAULT 0,
    error_message text,
    delta_token text,
    source_file text,
    CONSTRAINT chk_etl_status CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'success'::text, 'error'::text, 'cancelled'::text, 'partial'::text])))
);


--
-- Name: TABLE etl_sync_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.etl_sync_log IS 'Nhat ky ETL — dong bo tu Excel, BQMS, API';


--
-- Name: etl_sync_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.etl_sync_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: etl_sync_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.etl_sync_log_id_seq OWNED BY public.etl_sync_log.id;


--
-- Name: exchange_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exchange_rates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: exchange_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exchange_rates_id_seq OWNED BY public.exchange_rates.id;


--
-- Name: file_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_meta (
    id bigint NOT NULL,
    filename text NOT NULL,
    stored_filename text NOT NULL,
    file_path text NOT NULL,
    mime_type text NOT NULL,
    file_size bigint NOT NULL,
    checksum text,
    ref_type text,
    ref_id bigint,
    is_public boolean DEFAULT false NOT NULL,
    uploaded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE file_meta; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.file_meta IS 'Metadata file upload — luu tru checksum SHA-256';


--
-- Name: file_meta_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.file_meta_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: file_meta_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.file_meta_id_seq OWNED BY public.file_meta.id;


--
-- Name: file_review_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_review_status (
    id bigint NOT NULL,
    file_path text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    reason text,
    last_import_result jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT file_review_status_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'skipped'::text, 'imported'::text, 'error'::text])))
);


--
-- Name: file_review_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.file_review_status_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: file_review_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.file_review_status_id_seq OWNED BY public.file_review_status.id;


--
-- Name: fiscal_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiscal_periods (
    id bigint NOT NULL,
    period_code text NOT NULL,
    period_type text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    fiscal_year smallint NOT NULL,
    fiscal_quarter smallint,
    fiscal_month smallint,
    status text DEFAULT 'open'::text NOT NULL,
    closed_by uuid,
    closed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_period_dates CHECK ((end_date > start_date)),
    CONSTRAINT fiscal_periods_period_type_check CHECK ((period_type = ANY (ARRAY['month'::text, 'quarter'::text, 'year'::text]))),
    CONSTRAINT fiscal_periods_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closing'::text, 'closed'::text, 'locked'::text])))
);


--
-- Name: TABLE fiscal_periods; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fiscal_periods IS 'Ky ke toan — thang/quy/nam tai chinh';


--
-- Name: fiscal_periods_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fiscal_periods_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fiscal_periods_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fiscal_periods_id_seq OWNED BY public.fiscal_periods.id;


--
-- Name: help_articles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.help_articles (
    id bigint NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    content text NOT NULL,
    category text DEFAULT 'general'::text,
    order_index integer DEFAULT 0,
    is_published boolean DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: help_articles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.help_articles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: help_articles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.help_articles_id_seq OWNED BY public.help_articles.id;


--
-- Name: hs_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hs_codes (
    id bigint NOT NULL,
    hs_code text NOT NULL,
    description_vi text,
    description_en text,
    tax_rate numeric(5,2),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE hs_codes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hs_codes IS 'Ma HS hai quan — phan loai hang hoa xuat nhap khau';


--
-- Name: hs_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hs_codes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hs_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hs_codes_id_seq OWNED BY public.hs_codes.id;


--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_keys (
    key text NOT NULL,
    user_id uuid,
    endpoint text NOT NULL,
    response_body jsonb,
    status_code integer DEFAULT 200 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL
);


--
-- Name: import_export_tracking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_export_tracking (
    id bigint NOT NULL,
    company_id bigint,
    tracking_date date,
    rfq_number text,
    product_id bigint,
    bqms_code text,
    product_name text,
    detail_explain text,
    goods_type public.goods_type,
    maker text,
    unit_calc text,
    quantity_calc numeric(12,3),
    quote_deadline date,
    transaction_date date,
    customs_description text,
    hs_code text,
    hs_code_id bigint,
    unit text,
    quantity numeric(12,3),
    total_usd numeric(15,2),
    unit_price_usd numeric(15,4),
    unit_price_vnd numeric(15,2),
    buyer_name text,
    seller_name text,
    purchased_qty numeric(12,3),
    alt_supplier text,
    notes text,
    year smallint,
    data_source text DEFAULT 'excel_import'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    synced_at timestamp with time zone
);


--
-- Name: TABLE import_export_tracking; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.import_export_tracking IS 'Theo doi xuat nhap khau — tung giao dich';


--
-- Name: import_export_tracking_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.import_export_tracking_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: import_export_tracking_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.import_export_tracking_id_seq OWNED BY public.import_export_tracking.id;


--
-- Name: imv_consolidated; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.imv_consolidated (
    id bigint NOT NULL,
    quotation_no text,
    status text,
    purchaser_name text,
    purchaser_id uuid,
    customer_id bigint,
    customer_name text,
    customer_branch text,
    customer_item_code text,
    product_id bigint,
    product_code text,
    rfq_number text,
    product_name text,
    model text,
    specification text,
    maker text,
    unit text DEFAULT 'EA'::text,
    expected_order_qty numeric(12,3),
    prev_year_po_count integer,
    request_date date,
    quote_deadline date,
    end_date date,
    moq numeric(12,3),
    sales_person_name text,
    sales_person_id uuid,
    quoted_price numeric(15,4),
    purchase_price numeric(15,4),
    price_diff numeric(15,4),
    po_status text,
    po_qty numeric(12,3),
    po_amount numeric(15,2),
    profit numeric(15,2),
    notes text,
    data_source text DEFAULT 'excel_import'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    synced_at timestamp with time zone
);


--
-- Name: TABLE imv_consolidated; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.imv_consolidated IS 'Tong hop bao gia IMV — view quan ly';


--
-- Name: imv_consolidated_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.imv_consolidated_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: imv_consolidated_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.imv_consolidated_id_seq OWNED BY public.imv_consolidated.id;


--
-- Name: imv_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.imv_contracts (
    id bigint NOT NULL,
    contract_id character varying(100),
    contract_date date,
    customer_name text,
    customer_facility text,
    item_code character varying(100),
    product_name text,
    quantity numeric(18,4),
    unit character varying(40),
    unit_price numeric(18,4),
    total_amount numeric(18,4),
    currency character varying(8),
    status_text character varying(200),
    rfq_number character varying(100),
    raw_xml text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: imv_contracts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.imv_contracts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: imv_contracts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.imv_contracts_id_seq OWNED BY public.imv_contracts.id;


--
-- Name: imv_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.imv_deliveries (
    id bigint NOT NULL,
    delivery_type character varying(60),
    ship_to text,
    order_no_internal character varying(100),
    item_code character varying(100),
    product_name text,
    spec text,
    due_date date,
    shipped_date date,
    confirmed_date date,
    quantity numeric(18,4),
    confirmed_qty numeric(18,4),
    origin_country character varying(120),
    unit character varying(60),
    customer_name text,
    customer_facility text,
    customer_dept text,
    po_number character varying(100),
    delivery_address character varying(500),
    status character varying(40),
    stage character varying(60),
    stage2 character varying(60),
    shipment_id character varying(100),
    supplier_name text,
    raw_xml text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: imv_deliveries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.imv_deliveries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: imv_deliveries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.imv_deliveries_id_seq OWNED BY public.imv_deliveries.id;


--
-- Name: imv_inquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.imv_inquiries (
    id bigint NOT NULL,
    customer_name text,
    person_in_charge uuid,
    person_in_charge_name text,
    model text,
    product_name text,
    product_id bigint,
    maker text,
    inquiry_date date,
    purchase_price numeric(15,4),
    purchase_currency public.currency_code,
    selling_price numeric(15,4),
    quantity numeric(12,3),
    tax_rate numeric(5,2),
    hs_code text,
    hs_code_id bigint,
    weight_kg numeric(15,4),
    coefficient numeric(15,4),
    supplier_id bigint,
    supplier_name text,
    exchange_rate numeric(15,4),
    image_path text,
    notes text,
    data_source text DEFAULT 'excel_import'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    synced_at timestamp with time zone
);


--
-- Name: TABLE imv_inquiries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.imv_inquiries IS 'Yeu cau bao gia IMV — thuong mai quoc te';


--
-- Name: imv_inquiries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.imv_inquiries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: imv_inquiries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.imv_inquiries_id_seq OWNED BY public.imv_inquiries.id;


--
-- Name: imv_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.imv_orders (
    id bigint NOT NULL,
    status_text character varying(120),
    order_type character varying(120),
    order_date date,
    delivery_due date,
    po_number character varying(100),
    handler_name character varying(100),
    handler_login character varying(100),
    requester_name character varying(100),
    customer_name text,
    customer_facility text,
    item_code character varying(100),
    product_name text,
    spec text,
    model text,
    maker text,
    unit character varying(60),
    origin_country character varying(120),
    tax_label character varying(60),
    quantity numeric(18,4),
    currency character varying(16),
    unit_price numeric(18,4),
    amount numeric(18,4),
    delivery_address text,
    order_method character varying(120),
    po_internal_number character varying(100),
    raw_xml text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: imv_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.imv_orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: imv_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.imv_orders_id_seq OWNED BY public.imv_orders.id;


--
-- Name: imv_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.imv_payments (
    id bigint NOT NULL,
    payment_target character varying(120),
    paying_entity text,
    payment_method character varying(200),
    invoice_id character varying(100),
    invoice_date date,
    order_no character varying(100),
    po_no character varying(100),
    amount_id character varying(100),
    shipment_id character varying(100),
    item_code character varying(100),
    product_name text,
    model text,
    quantity numeric(18,4),
    unit character varying(60),
    currency character varying(16),
    unit_price numeric(18,4),
    total_amount numeric(18,4),
    tax_label character varying(60),
    customer_code character varying(100),
    customer_name text,
    customer_dept text,
    payment_type character varying(60),
    raw_xml text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: imv_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.imv_payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: imv_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.imv_payments_id_seq OWNED BY public.imv_payments.id;


--
-- Name: imv_purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.imv_purchase_orders (
    id bigint NOT NULL,
    po_date date,
    po_number text NOT NULL,
    product_id bigint,
    product_code text,
    product_name text,
    unit text DEFAULT 'EA'::text,
    requested_qty numeric(12,3),
    unit_price numeric(15,4),
    amount numeric(15,2),
    vat_amount numeric(15,2),
    total_amount numeric(15,2),
    purchasing_dept text,
    delivered_qty numeric(12,3) DEFAULT 0,
    actual_delivery_date date,
    invoice_date date,
    remaining_qty numeric(12,3) DEFAULT 0,
    buying_qty numeric(12,3),
    buying_unit_price numeric(15,4),
    buying_exchange_rate numeric(15,4),
    buying_price_vnd numeric(15,2),
    buying_amount numeric(15,2),
    shipping_cost numeric(15,2),
    buying_total numeric(15,2),
    paid_amount numeric(15,2) DEFAULT 0,
    outstanding numeric(15,2) DEFAULT 0,
    supplier_id bigint,
    supplier_name text,
    document_ref text,
    notes text,
    data_source text DEFAULT 'excel_import'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    synced_at timestamp with time zone
);


--
-- Name: TABLE imv_purchase_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.imv_purchase_orders IS 'Don dat hang IMV — mua tu NCC cho thuong mai';


--
-- Name: imv_purchase_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.imv_purchase_orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: imv_purchase_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.imv_purchase_orders_id_seq OWNED BY public.imv_purchase_orders.id;


--
-- Name: imv_rejections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.imv_rejections (
    id bigint NOT NULL,
    rejection_id character varying(100),
    rejection_date date,
    shipment_id character varying(100),
    customer_name text,
    item_code character varying(100),
    product_name text,
    quantity numeric(18,4),
    reason text,
    status_text character varying(200),
    raw_xml text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: imv_rejections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.imv_rejections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: imv_rejections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.imv_rejections_id_seq OWNED BY public.imv_rejections.id;


--
-- Name: imv_rfq; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.imv_rfq (
    id bigint NOT NULL,
    rfq_number character varying(100) NOT NULL,
    status_text character varying(80),
    handler_name character varying(200),
    handler_login character varying(60),
    customer_name text,
    customer_facility text,
    customer_item_code character varying(80),
    item_code character varying(100),
    product_name text,
    model text,
    spec text,
    maker text,
    unit character varying(40),
    quantity numeric(18,4),
    offered_qty numeric(18,4),
    request_date date,
    due_date date,
    due_time character varying(12),
    doc_type character varying(40),
    flow_status character varying(40),
    request_id character varying(40),
    item_code_internal character varying(40),
    requester_id character varying(40),
    raw_xml text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: imv_rfq_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.imv_rfq_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: imv_rfq_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.imv_rfq_id_seq OWNED BY public.imv_rfq.id;


--
-- Name: imv_sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.imv_sync_log (
    id bigint NOT NULL,
    status character varying(20) NOT NULL,
    total_records integer,
    new_records integer,
    updated_records integer,
    error_message text,
    duration_seconds numeric(8,2),
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    entity_type character varying(20) DEFAULT 'rfq'::character varying
);


--
-- Name: imv_sync_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.imv_sync_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: imv_sync_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.imv_sync_log_id_seq OWNED BY public.imv_sync_log.id;


--
-- Name: inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory (
    id bigint NOT NULL,
    product_id bigint NOT NULL,
    product_code text NOT NULL,
    product_name text NOT NULL,
    name_unaccent text GENERATED ALWAYS AS (public.immutable_unaccent(lower(product_name))) STORED,
    category text,
    brand text,
    specification text,
    unit text DEFAULT 'EA'::text NOT NULL,
    quantity numeric(12,3) DEFAULT 0 NOT NULL,
    reserved_qty numeric(12,3) DEFAULT 0 NOT NULL,
    available_qty numeric(12,3) GENERATED ALWAYS AS ((quantity - reserved_qty)) STORED,
    min_stock numeric(12,3) DEFAULT 0,
    max_stock numeric(12,3),
    location text,
    unit_cost numeric(15,4),
    version integer DEFAULT 1 NOT NULL,
    last_updated timestamp with time zone DEFAULT now(),
    notes text,
    CONSTRAINT inventory_quantity_check CHECK ((quantity >= (0)::numeric)),
    CONSTRAINT inventory_reserved_qty_check CHECK ((reserved_qty >= (0)::numeric))
);


--
-- Name: TABLE inventory; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inventory IS 'Ton kho — available_qty tu dong, version de tranh xung dot';


--
-- Name: inventory_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_id_seq OWNED BY public.inventory.id;


--
-- Name: inventory_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_movements (
    id bigint NOT NULL,
    product_id bigint,
    product_code text NOT NULL,
    movement_type text NOT NULL,
    quantity numeric(12,3) NOT NULL,
    reference_type text,
    reference_id bigint,
    before_qty numeric(12,3) NOT NULL,
    after_qty numeric(12,3) NOT NULL,
    unit_cost numeric(15,4),
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['in'::text, 'out'::text, 'adjust'::text]))),
    CONSTRAINT inventory_movements_reference_type_check CHECK ((reference_type = ANY (ARRAY['po'::text, 'sale'::text, 'bqms_delivery'::text, 'imv_delivery'::text, 'adjustment'::text, 'return'::text])))
);


--
-- Name: TABLE inventory_movements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inventory_movements IS 'Lich su xuat/nhap kho — before/after de kiem tra';


--
-- Name: inventory_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_movements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_movements_id_seq OWNED BY public.inventory_movements.id;


--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_items (
    id bigint NOT NULL,
    invoice_id bigint NOT NULL,
    line_number integer NOT NULL,
    so_line_id bigint,
    product_id bigint,
    bqms_code text,
    description text NOT NULL,
    specification text,
    unit text DEFAULT 'EA'::text NOT NULL,
    quantity numeric(12,3) NOT NULL,
    unit_price numeric(14,4) NOT NULL,
    vat_rate numeric(5,2) DEFAULT 10 NOT NULL,
    subtotal numeric(16,2) GENERATED ALWAYS AS ((quantity * unit_price)) STORED,
    vat_amount numeric(16,2) GENERATED ALWAYS AS (round((((quantity * unit_price) * vat_rate) / (100)::numeric), 2)) STORED,
    line_total numeric(16,2) GENERATED ALWAYS AS (((quantity * unit_price) + round((((quantity * unit_price) * vat_rate) / (100)::numeric), 2))) STORED,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoice_items_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: invoice_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_items_id_seq OWNED BY public.invoice_items.id;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id bigint NOT NULL,
    invoice_number text NOT NULL,
    customer_id bigint NOT NULL,
    sales_order_id bigint,
    chain_code text,
    status text DEFAULT 'draft'::text NOT NULL,
    invoice_date date DEFAULT CURRENT_DATE NOT NULL,
    due_date date NOT NULL,
    currency text DEFAULT 'VND'::text NOT NULL,
    subtotal numeric(16,2) DEFAULT 0 NOT NULL,
    vat_amount numeric(16,2) DEFAULT 0 NOT NULL,
    total_amount numeric(16,2) DEFAULT 0 NOT NULL,
    paid_amount numeric(16,2) DEFAULT 0 NOT NULL,
    balance_due numeric(16,2) GENERATED ALWAYS AS ((total_amount - paid_amount)) STORED,
    payment_terms text DEFAULT 'NET30'::text,
    bank_account text,
    pdf_path text,
    sent_at timestamp with time zone,
    sent_via text,
    notes text,
    ar_id bigint,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'partially_paid'::text, 'paid'::text, 'overdue'::text, 'cancelled'::text, 'disputed'::text])))
);


--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;


--
-- Name: leave_balance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_balance (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    period_year smallint NOT NULL,
    annual_used numeric(4,1) DEFAULT 0 NOT NULL,
    sick_used numeric(4,1) DEFAULT 0 NOT NULL,
    personal_used numeric(4,1) DEFAULT 0 NOT NULL,
    maternity_used numeric(4,1) DEFAULT 0 NOT NULL,
    other_used numeric(4,1) DEFAULT 0 NOT NULL,
    annual_total numeric(4,1) DEFAULT 12 NOT NULL,
    sick_total numeric(4,1) DEFAULT 30 NOT NULL,
    personal_total numeric(4,1) DEFAULT 3 NOT NULL,
    maternity_total numeric(4,1) DEFAULT 180 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT leave_balance_period_year_check CHECK (((period_year >= 2024) AND (period_year <= 2099)))
);


--
-- Name: leave_balance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.leave_balance_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_balance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.leave_balance_id_seq OWNED BY public.leave_balance.id;


--
-- Name: leave_policy_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.leave_policy_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_policy_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.leave_policy_id_seq OWNED BY public.leave_policy.id;


--
-- Name: leave_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.leave_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.leave_requests_id_seq OWNED BY public.leave_requests.id;


--
-- Name: market_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_prices (
    id bigint NOT NULL,
    source text DEFAULT '52wmb'::text NOT NULL,
    hs_code text,
    product_name text NOT NULL,
    specification text,
    maker text,
    supplier_name text,
    supplier_country text,
    unit_price numeric(15,4),
    currency text DEFAULT 'USD'::text,
    quantity numeric(12,3),
    trade_date date,
    source_url text,
    raw_data jsonb,
    crawled_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: market_prices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.market_prices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: market_prices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.market_prices_id_seq OWNED BY public.market_prices.id;


--
-- Name: material_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_types (
    id bigint NOT NULL,
    type_code text NOT NULL,
    type_name text NOT NULL,
    unit_price_kg numeric(15,2),
    density_g_cm3 numeric(8,4),
    supplier_name text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE material_types; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.material_types IS 'Loai vat lieu — thep, nhom, dong, inox,...';


--
-- Name: material_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.material_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: material_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.material_types_id_seq OWNED BY public.material_types.id;


--
-- Name: mv_bqms_win_rate; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_bqms_win_rate AS
 SELECT (date_trunc('month'::text, (inquiry_date)::timestamp with time zone))::date AS month,
    count(*) AS total_rfqs,
    count(*) FILTER (WHERE (result = 'won'::public.rfq_result)) AS won,
    count(*) FILTER (WHERE (result = 'lost'::public.rfq_result)) AS lost,
    round((((count(*) FILTER (WHERE (result = 'won'::public.rfq_result)))::numeric * 100.0) / (NULLIF(count(*) FILTER (WHERE (result = ANY (ARRAY['won'::public.rfq_result, 'lost'::public.rfq_result]))), 0))::numeric), 2) AS win_rate_pct,
    now() AS refreshed_at
   FROM public.bqms_rfq
  WHERE (inquiry_date IS NOT NULL)
  GROUP BY (date_trunc('month'::text, (inquiry_date)::timestamp with time zone))
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW mv_bqms_win_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.mv_bqms_win_rate IS 'Ty le trung BQMS theo thang';


--
-- Name: mv_inventory_value; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_inventory_value AS
 SELECT COALESCE(category, 'Chua phan loai'::text) AS category,
    count(*) AS item_count,
    sum(quantity) AS total_qty,
    sum((quantity * COALESCE(unit_cost, (0)::numeric))) AS total_value,
    sum(reserved_qty) AS total_reserved,
    sum((quantity - reserved_qty)) AS total_available,
    now() AS refreshed_at
   FROM public.inventory
  WHERE (quantity > (0)::numeric)
  GROUP BY COALESCE(category, 'Chua phan loai'::text)
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW mv_inventory_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.mv_inventory_value IS 'Gia tri ton kho theo danh muc';


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id bigint NOT NULL,
    po_number text NOT NULL,
    supplier_id bigint NOT NULL,
    customer_id bigint,
    company_id bigint,
    workflow_id bigint,
    status public.po_status DEFAULT 'draft'::public.po_status NOT NULL,
    subtotal numeric(15,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(15,2) DEFAULT 0 NOT NULL,
    shipping_cost numeric(15,2) DEFAULT 0,
    total_amount numeric(15,2) DEFAULT 0 NOT NULL,
    currency public.currency_code DEFAULT 'USD'::public.currency_code,
    exchange_rate numeric(15,4),
    amount_vnd numeric(18,2) GENERATED ALWAYS AS ((total_amount * COALESCE(exchange_rate, (1)::numeric))) STORED,
    order_date date,
    expected_date date,
    confirmed_date date,
    received_date date,
    approved_at timestamp with time zone,
    sent_to_supplier_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_reason text,
    incoterms text,
    shipping_method text,
    tracking_number text,
    attachment_path text,
    notes text,
    internal_note text,
    business_system public.business_system,
    created_by uuid NOT NULL,
    approved_by uuid,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    supplier_quote_id bigint,
    sales_order_id bigint,
    chain_code text,
    needs_review boolean DEFAULT false NOT NULL,
    sourcing_order_id bigint,
    CONSTRAINT purchase_orders_subtotal_check CHECK ((subtotal >= (0)::numeric)),
    CONSTRAINT purchase_orders_tax_amount_check CHECK ((tax_amount >= (0)::numeric)),
    CONSTRAINT purchase_orders_total_amount_check CHECK ((total_amount >= (0)::numeric))
);


--
-- Name: TABLE purchase_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.purchase_orders IS 'Don dat hang noi bo — amount_vnd tu dong tinh';


--
-- Name: mv_po_pipeline; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_po_pipeline AS
 SELECT status,
    business_system,
    count(*) AS po_count,
    sum(total_amount) AS total_value,
    currency,
    now() AS refreshed_at
   FROM public.purchase_orders
  GROUP BY status, business_system, currency
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW mv_po_pipeline; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.mv_po_pipeline IS 'PO pipeline — so luong va gia tri theo trang thai';


--
-- Name: mv_refresh_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mv_refresh_log (
    id bigint NOT NULL,
    view_name text NOT NULL,
    refresh_type text DEFAULT 'full'::text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    status text DEFAULT 'running'::text NOT NULL,
    rows_affected integer,
    duration_ms integer,
    error_message text
);


--
-- Name: TABLE mv_refresh_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mv_refresh_log IS 'Nhat ky refresh Materialized View';


--
-- Name: mv_refresh_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mv_refresh_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mv_refresh_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mv_refresh_log_id_seq OWNED BY public.mv_refresh_log.id;


--
-- Name: revenue_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revenue_invoices (
    id bigint NOT NULL,
    company_id bigint,
    invoice_number text,
    invoice_date date,
    invoice_month smallint,
    invoice_year smallint,
    customer_id bigint,
    customer_name text,
    product_id bigint,
    product_name text,
    unit text DEFAULT 'EA'::text,
    quantity numeric(12,3),
    unit_price numeric(15,4),
    amount numeric(15,2),
    tax_rate numeric(5,2),
    vat_amount numeric(15,2),
    total_amount numeric(15,2),
    po_number text,
    po_id bigint,
    samsung_po_id bigint,
    imv_po_id bigint,
    sales_order_id bigint,
    purchase_price numeric(15,4),
    purchase_vat numeric(15,2),
    shipping_cost numeric(15,2),
    commission numeric(15,2),
    customer_quoted numeric(15,4),
    invoice_buying numeric(15,2),
    customs_fee numeric(15,2),
    export_tax numeric(15,2),
    other_costs numeric(15,2),
    total_cost numeric(15,2),
    profit numeric(15,2),
    advance_payment numeric(15,2),
    remaining_payment numeric(15,2),
    data_source text DEFAULT 'excel_import'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    synced_at timestamp with time zone,
    CONSTRAINT revenue_invoices_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: TABLE revenue_invoices; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.revenue_invoices IS 'Hoa don doanh thu — chi phi + loi nhuan';


--
-- Name: mv_revenue_monthly; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_revenue_monthly AS
 SELECT invoice_year,
    invoice_month,
    company_id,
    count(*) AS invoice_count,
    sum(amount) AS total_revenue,
    sum(vat_amount) AS total_vat,
    sum(total_amount) AS total_with_vat,
    sum(total_cost) AS total_cost,
    sum(profit) AS total_profit,
    round(((sum(profit) * 100.0) / NULLIF(sum(amount), (0)::numeric)), 2) AS profit_margin_pct,
    now() AS refreshed_at
   FROM public.revenue_invoices
  WHERE ((invoice_year IS NOT NULL) AND (invoice_month IS NOT NULL))
  GROUP BY invoice_year, invoice_month, company_id
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW mv_revenue_monthly; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.mv_revenue_monthly IS 'Doanh thu theo thang — revenue, cost, profit';


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id bigint NOT NULL,
    name text NOT NULL,
    name_unaccent text GENERATED ALWAYS AS (public.immutable_unaccent(lower(name))) STORED,
    contact_name text,
    contact_email text,
    contact_phone text,
    contact_wechat text,
    country text DEFAULT 'CN'::text,
    address text,
    payment_terms text,
    lead_time_days smallint,
    rating numeric(3,1),
    default_currency public.currency_code DEFAULT 'USD'::public.currency_code,
    tax_code text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    overall_score numeric(5,2),
    CONSTRAINT suppliers_rating_check CHECK (((rating >= (0)::numeric) AND (rating <= (5)::numeric)))
);


--
-- Name: TABLE suppliers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.suppliers IS 'Nha cung cap — chu yeu TQ, danh gia 0-5 sao';


--
-- Name: mv_supplier_performance; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_supplier_performance AS
 SELECT s.id AS supplier_id,
    s.name AS supplier_name,
    count(po.id) AS total_pos,
    count(po.id) FILTER (WHERE (po.status = 'received'::public.po_status)) AS completed_pos,
    count(po.id) FILTER (WHERE (po.status = 'cancelled'::public.po_status)) AS cancelled_pos,
    round(avg(
        CASE
            WHEN ((po.received_date IS NOT NULL) AND (po.order_date IS NOT NULL)) THEN (po.received_date - po.order_date)
            ELSE NULL::integer
        END), 1) AS avg_lead_time_days,
    (((count(po.id) FILTER (WHERE ((po.received_date IS NOT NULL) AND (po.expected_date IS NOT NULL) AND (po.received_date <= po.expected_date))))::numeric * 100.0) / (NULLIF(count(po.id) FILTER (WHERE (po.received_date IS NOT NULL)), 0))::numeric) AS on_time_rate_pct,
    s.rating,
    now() AS refreshed_at
   FROM (public.suppliers s
     LEFT JOIN public.purchase_orders po ON ((po.supplier_id = s.id)))
  WHERE (s.deleted_at IS NULL)
  GROUP BY s.id, s.name, s.rating
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW mv_supplier_performance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.mv_supplier_performance IS 'Hieu suat NCC — on-time rate, avg lead time';


--
-- Name: mv_vat_declaration_monthly; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_vat_declaration_monthly AS
 SELECT invoice_year AS year,
    invoice_month AS month,
    company_id,
    sum(amount) AS output_revenue,
    sum(vat_amount) AS output_vat,
    ( SELECT COALESCE(sum((ap.amount_vnd * 0.1)), (0)::numeric) AS "coalesce"
           FROM public.accounts_payable ap
          WHERE ((EXTRACT(year FROM ap.invoice_date) = (ri.invoice_year)::numeric) AND (EXTRACT(month FROM ap.invoice_date) = (ri.invoice_month)::numeric) AND ((ri.company_id IS NULL) OR (ap.supplier_id IS NOT NULL)))) AS input_vat_estimate,
    (sum(vat_amount) - ( SELECT COALESCE(sum((ap2.amount_vnd * 0.1)), (0)::numeric) AS "coalesce"
           FROM public.accounts_payable ap2
          WHERE ((EXTRACT(year FROM ap2.invoice_date) = (ri.invoice_year)::numeric) AND (EXTRACT(month FROM ap2.invoice_date) = (ri.invoice_month)::numeric)))) AS vat_payable,
    now() AS refreshed_at
   FROM public.revenue_invoices ri
  WHERE ((invoice_year IS NOT NULL) AND (invoice_month IS NOT NULL))
  GROUP BY invoice_year, invoice_month, company_id
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW mv_vat_declaration_monthly; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.mv_vat_declaration_monthly IS 'Tong hop VAT hang thang — ke khai thue GTGT';


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    recipient_id uuid NOT NULL,
    type public.notification_type NOT NULL,
    title text NOT NULL,
    body text,
    is_read boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    ref_type text,
    ref_id bigint,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    recipient_vendor_id bigint
);


--
-- Name: TABLE notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notifications IS 'Thong bao noi bo — workflow, canh bao ton kho, nhac hen';


--
-- Name: COLUMN notifications.recipient_vendor_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.recipient_vendor_id IS 'Vendor-portal recipient (vendor_accounts.id). NULL for admin rows (which use recipient_id = users.id).';


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: ocr_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ocr_results (
    id bigint NOT NULL,
    document_id bigint,
    file_name text NOT NULL,
    ocr_engine text DEFAULT 'gemini_vision'::text,
    extracted_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    raw_text text,
    confidence numeric(5,2),
    status text DEFAULT 'pending'::text,
    error_message text,
    processed_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ocr_results_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: ocr_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ocr_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ocr_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ocr_results_id_seq OWNED BY public.ocr_results.id;


--
-- Name: onedrive_file_index; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onedrive_file_index (
    id bigint NOT NULL,
    graph_item_id text NOT NULL,
    graph_parent_id text,
    name text NOT NULL,
    file_path text NOT NULL,
    file_extension text,
    file_size bigint DEFAULT 0 NOT NULL,
    mime_type text,
    is_folder boolean DEFAULT false NOT NULL,
    remote_created_at timestamp with time zone,
    remote_modified_at timestamp with time zone,
    is_cached boolean DEFAULT false NOT NULL,
    local_path text,
    cached_at timestamp with time zone,
    cache_size bigint DEFAULT 0,
    sync_status text DEFAULT 'indexed'::text NOT NULL,
    last_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    etag text,
    converted_path text,
    converted_at timestamp with time zone,
    name_trgm text GENERATED ALWAYS AS (lower(name)) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: onedrive_file_index_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.onedrive_file_index_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: onedrive_file_index_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.onedrive_file_index_id_seq OWNED BY public.onedrive_file_index.id;


--
-- Name: payment_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_requests (
    id bigint NOT NULL,
    company_id bigint,
    requester_id uuid NOT NULL,
    requester_name text,
    department text,
    request_date date NOT NULL,
    workflow_id bigint,
    description text NOT NULL,
    amount numeric(15,2) NOT NULL,
    currency public.currency_code DEFAULT 'VND'::public.currency_code,
    payment_method text,
    beneficiary_name text,
    beneficiary_bank text,
    beneficiary_account text,
    status text DEFAULT 'draft'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    paid_at timestamp with time zone,
    notes text,
    attachments text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sourcing_order_id bigint,
    rejection_reason text,
    rejected_by uuid,
    rejected_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT payment_requests_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'approved'::text, 'paid'::text, 'rejected'::text, 'cancelled'::text])))
);


--
-- Name: TABLE payment_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payment_requests IS 'De nghi thanh toan — lien ket workflow duyet';


--
-- Name: payment_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_requests_id_seq OWNED BY public.payment_requests.id;


--
-- Name: payment_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_transactions (
    id bigint NOT NULL,
    direction public.payment_direction NOT NULL,
    ap_id bigint,
    ar_id bigint,
    payment_date date NOT NULL,
    amount numeric(15,2) NOT NULL,
    currency public.currency_code DEFAULT 'VND'::public.currency_code,
    exchange_rate numeric(15,4),
    payment_method text,
    bank_name text,
    bank_ref text,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE payment_transactions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payment_transactions IS 'Giao dich thanh toan — thu/chi tung lan';


--
-- Name: payment_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_transactions_id_seq OWNED BY public.payment_transactions.id;


--
-- Name: pet_exp_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pet_exp_log (
    id bigint NOT NULL,
    user_pet_id uuid NOT NULL,
    event_type text NOT NULL,
    exp_delta integer NOT NULL,
    source_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE pet_exp_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pet_exp_log IS 'EXP audit log — mỗi event mỗi row';


--
-- Name: pet_exp_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pet_exp_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pet_exp_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pet_exp_log_id_seq OWNED BY public.pet_exp_log.id;


--
-- Name: pet_species_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pet_species_catalog (
    species text NOT NULL,
    display_name_vi text NOT NULL,
    description_vi text,
    form_1_sprite text NOT NULL,
    form_2_sprite text NOT NULL,
    form_3_sprite text NOT NULL,
    unlock_level_2 integer DEFAULT 5,
    unlock_level_3 integer DEFAULT 20,
    rarity text DEFAULT 'common'::text,
    color_theme text,
    sort_order integer DEFAULT 100
);


--
-- Name: TABLE pet_species_catalog; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pet_species_catalog IS 'Catalog 9 loài pet với 3 hình thái mỗi loài (Thang 2026-05-12)';


--
-- Name: pim_enrichment_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pim_enrichment_audit (
    id bigint NOT NULL,
    run_id text NOT NULL,
    entry_id bigint NOT NULL,
    pim_row_idx integer,
    match_tier text NOT NULL,
    before_json jsonb NOT NULL,
    after_json jsonb NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pim_enrichment_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pim_enrichment_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pim_enrichment_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pim_enrichment_audit_id_seq OWNED BY public.pim_enrichment_audit.id;


--
-- Name: po_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.po_line_items (
    id bigint NOT NULL,
    po_id bigint NOT NULL,
    line_number smallint NOT NULL,
    product_id bigint,
    product_code text,
    product_name text NOT NULL,
    specification text,
    maker text,
    quantity numeric(12,3) NOT NULL,
    unit text DEFAULT 'EA'::text NOT NULL,
    unit_price numeric(15,4) NOT NULL,
    subtotal numeric(15,4) GENERATED ALWAYS AS ((quantity * unit_price)) STORED,
    currency public.currency_code DEFAULT 'USD'::public.currency_code,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT po_line_items_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT po_line_items_unit_price_check CHECK ((unit_price >= (0)::numeric))
);


--
-- Name: TABLE po_line_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.po_line_items IS 'Chi tiet dong PO — subtotal = quantity * unit_price';


--
-- Name: po_line_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.po_line_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: po_line_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.po_line_items_id_seq OWNED BY public.po_line_items.id;


--
-- Name: po_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.po_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: price_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_history (
    id bigint NOT NULL,
    product_code text NOT NULL,
    supplier_id bigint NOT NULL,
    unit_price numeric(15,4) NOT NULL,
    currency public.currency_code DEFAULT 'USD'::public.currency_code,
    quantity numeric(12,3),
    po_id bigint,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE price_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.price_history IS 'Lich su gia mua — phan tich xu huong gia';


--
-- Name: price_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.price_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: price_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.price_history_id_seq OWNED BY public.price_history.id;


--
-- Name: price_intel_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_intel_config (
    key text NOT NULL,
    value numeric NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: procrastinate_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procrastinate_events (
    id bigint NOT NULL,
    job_id bigint NOT NULL,
    type public.procrastinate_job_event_type,
    at timestamp with time zone DEFAULT now()
);


--
-- Name: procrastinate_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procrastinate_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procrastinate_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procrastinate_events_id_seq OWNED BY public.procrastinate_events.id;


--
-- Name: procrastinate_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procrastinate_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procrastinate_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procrastinate_jobs_id_seq OWNED BY public.procrastinate_jobs.id;


--
-- Name: procrastinate_periodic_defers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procrastinate_periodic_defers (
    id bigint NOT NULL,
    task_name character varying(128) NOT NULL,
    defer_timestamp bigint,
    job_id bigint,
    periodic_id character varying(128) DEFAULT ''::character varying NOT NULL
);


--
-- Name: procrastinate_periodic_defers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procrastinate_periodic_defers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procrastinate_periodic_defers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procrastinate_periodic_defers_id_seq OWNED BY public.procrastinate_periodic_defers.id;


--
-- Name: procurement_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_audit_log (
    id bigint NOT NULL,
    entity_type text NOT NULL,
    entity_id bigint NOT NULL,
    action text NOT NULL,
    from_status text,
    to_status text,
    actor_id uuid,
    actor_vendor_id bigint,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: procurement_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_audit_log_id_seq OWNED BY public.procurement_audit_log.id;


--
-- Name: procurement_awards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_awards (
    id bigint NOT NULL,
    batch_id bigint NOT NULL,
    item_id bigint,
    vendor_id bigint NOT NULL,
    quote_id bigint,
    quote_item_id bigint,
    awarded_price numeric,
    currency text DEFAULT 'VND'::text NOT NULL,
    quantity numeric,
    award_reason text,
    awarded_by uuid,
    awarded_at timestamp with time zone DEFAULT now() NOT NULL,
    superseded_by bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    written_back_to_sourcing boolean DEFAULT false,
    written_back_at timestamp with time zone,
    written_back_by uuid,
    sourcing_supplier_price_id bigint,
    CONSTRAINT procurement_awards_currency_check CHECK ((currency = ANY (ARRAY['VND'::text, 'JPY'::text, 'USD'::text, 'KRW'::text, 'RMB'::text, 'EUR'::text])))
);


--
-- Name: procurement_awards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_awards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_awards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_awards_id_seq OWNED BY public.procurement_awards.id;


--
-- Name: procurement_bid_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_bid_tokens (
    id bigint NOT NULL,
    token text NOT NULL,
    batch_id bigint NOT NULL,
    vendor_id bigint,
    invitee_email text,
    invitee_name text,
    invitee_company text,
    invitee_phone text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    round_number integer DEFAULT 1 NOT NULL,
    first_opened_at timestamp with time zone,
    last_opened_at timestamp with time zone,
    open_count integer DEFAULT 0 NOT NULL,
    submitted_quote_id bigint,
    email_sent_at timestamp with time zone,
    email_subject text,
    email_status text,
    email_error text
);


--
-- Name: procurement_bid_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_bid_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_bid_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_bid_tokens_id_seq OWNED BY public.procurement_bid_tokens.id;


--
-- Name: procurement_contract_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_contract_items (
    id bigint NOT NULL,
    contract_id bigint NOT NULL,
    rfq_item_id bigint,
    item_no integer NOT NULL,
    bqms_code text,
    specification text NOT NULL,
    quantity numeric NOT NULL,
    unit text DEFAULT 'EA'::text NOT NULL,
    unit_price numeric NOT NULL,
    total_price numeric GENERATED ALWAYS AS ((quantity * unit_price)) STORED,
    lead_time_days integer,
    notes text
);


--
-- Name: procurement_contract_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_contract_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_contract_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_contract_items_id_seq OWNED BY public.procurement_contract_items.id;


--
-- Name: procurement_contract_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_contract_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_contracts (
    id bigint NOT NULL,
    contract_no text NOT NULL,
    batch_id bigint NOT NULL,
    vendor_id bigint,
    vendor_name text NOT NULL,
    vendor_email text,
    vendor_phone text,
    vendor_tax_code text,
    vendor_address text,
    total_amount numeric NOT NULL,
    currency text DEFAULT 'VND'::text NOT NULL,
    payment_terms text,
    delivery_terms text,
    warranty_terms text,
    status text DEFAULT 'draft'::text NOT NULL,
    contract_date date,
    effective_date date,
    expiry_date date,
    sent_to_vendor_at timestamp with time zone,
    signed_at timestamp with time zone,
    signed_by_vendor text,
    signed_ip inet,
    signature_data jsonb,
    contract_file_path text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    signed_by_user uuid,
    pdf_generated_at timestamp with time zone,
    CONSTRAINT procurement_contracts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'signed'::text, 'active'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: procurement_contracts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_contracts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_contracts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_contracts_id_seq OWNED BY public.procurement_contracts.id;


--
-- Name: procurement_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_deliveries (
    id bigint NOT NULL,
    delivery_no text NOT NULL,
    po_id bigint NOT NULL,
    vendor_id bigint,
    delivered_at timestamp with time zone,
    delivery_method text,
    tracking_no text,
    status text DEFAULT 'pending'::text NOT NULL,
    received_at timestamp with time zone,
    received_by uuid,
    rejection_reason text,
    photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    documents jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    vendor_invoice_no text,
    invoice_date date,
    packing_qty numeric,
    packing_unit text,
    gross_weight numeric,
    delivery_note_path text,
    CONSTRAINT procurement_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'shipping'::text, 'arrived'::text, 'received'::text, 'rejected'::text, 'returned'::text])))
);


--
-- Name: procurement_deliveries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_deliveries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_deliveries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_deliveries_id_seq OWNED BY public.procurement_deliveries.id;


--
-- Name: procurement_delivery_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_delivery_items (
    id bigint NOT NULL,
    delivery_id bigint NOT NULL,
    po_item_id bigint NOT NULL,
    delivered_qty numeric NOT NULL,
    quality_status text DEFAULT 'ok'::text NOT NULL,
    notes text,
    confirmed_qty numeric,
    confirmed_by uuid,
    confirmed_at timestamp with time zone,
    CONSTRAINT procurement_delivery_items_quality_status_check CHECK ((quality_status = ANY (ARRAY['ok'::text, 'minor_defect'::text, 'rejected'::text])))
);


--
-- Name: COLUMN procurement_delivery_items.confirmed_qty; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.procurement_delivery_items.confirmed_qty IS 'Số buyer XÁC NHẬN thực nhận (NULL = chưa → progress/AP fallback delivered_qty).';


--
-- Name: COLUMN procurement_delivery_items.confirmed_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.procurement_delivery_items.confirmed_by IS 'users.id (UUID) nội bộ đã xác nhận. KHÁC vendor (delivered_qty do NCC khai).';


--
-- Name: COLUMN procurement_delivery_items.confirmed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.procurement_delivery_items.confirmed_at IS 'Thời điểm xác nhận (NULL = chưa).';


--
-- Name: procurement_delivery_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_delivery_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_delivery_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_delivery_items_id_seq OWNED BY public.procurement_delivery_items.id;


--
-- Name: procurement_delivery_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_delivery_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_po_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_po_items (
    id bigint NOT NULL,
    po_id bigint NOT NULL,
    contract_item_id bigint,
    item_no integer NOT NULL,
    bqms_code text,
    specification text NOT NULL,
    ordered_qty numeric NOT NULL,
    delivered_qty numeric DEFAULT 0 NOT NULL,
    unit text DEFAULT 'EA'::text NOT NULL,
    unit_price numeric NOT NULL,
    total_price numeric GENERATED ALWAYS AS ((ordered_qty * unit_price)) STORED,
    notes text
);


--
-- Name: procurement_po_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_po_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_po_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_po_items_id_seq OWNED BY public.procurement_po_items.id;


--
-- Name: procurement_po_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_po_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_pos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_pos (
    id bigint NOT NULL,
    po_no text NOT NULL,
    contract_id bigint,
    batch_id bigint,
    vendor_id bigint,
    vendor_name text NOT NULL,
    po_date date DEFAULT CURRENT_DATE NOT NULL,
    requested_delivery_date date,
    actual_delivery_date date,
    total_amount numeric NOT NULL,
    currency text DEFAULT 'VND'::text NOT NULL,
    payment_status text DEFAULT 'pending'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    delivery_address text,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    acknowledged_at timestamp with time zone,
    acknowledged_by bigint,
    ack_note text,
    delivery_reminder_sent_at timestamp with time zone,
    CONSTRAINT procurement_pos_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'partial'::text, 'paid'::text]))),
    CONSTRAINT procurement_pos_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'open'::text, 'partially_delivered'::text, 'delivered'::text, 'closed'::text, 'cancelled'::text])))
);


--
-- Name: COLUMN procurement_pos.acknowledged_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.procurement_pos.acknowledged_at IS 'Thời điểm NCC xác nhận đã nhận PO (NULL = chưa xác nhận).';


--
-- Name: COLUMN procurement_pos.acknowledged_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.procurement_pos.acknowledged_by IS 'vendor_accounts.id của NCC đã xác nhận.';


--
-- Name: COLUMN procurement_pos.ack_note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.procurement_pos.ack_note IS 'Ghi chú NCC khi xác nhận (tùy chọn).';


--
-- Name: COLUMN procurement_pos.delivery_reminder_sent_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.procurement_pos.delivery_reminder_sent_at IS 'Đợt10 #17: NULL = chưa cảnh báo hạn giao. Set NOW() khi sweep đã gửi notif nội bộ -> nhắc đúng 1 lần/PO.';


--
-- Name: procurement_pos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_pos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_pos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_pos_id_seq OWNED BY public.procurement_pos.id;


--
-- Name: procurement_rfq_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_rfq_batches (
    id bigint NOT NULL,
    batch_code text NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'draft'::text NOT NULL,
    award_mode text DEFAULT 'per_item'::text NOT NULL,
    published_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_by uuid NOT NULL,
    item_count integer DEFAULT 0,
    quote_count integer DEFAULT 0,
    notes_internal text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deadline_v1 timestamp with time zone,
    deadline_v2 timestamp with time zone,
    deadline_v3 timestamp with time zone,
    current_round integer DEFAULT 1 NOT NULL,
    reg_dt timestamp with time zone,
    req_name text,
    requester text,
    department text,
    person_in_charge text,
    criteria_currency text,
    ctr_type_name text,
    dday_text text,
    source_bqms_rfq_number text,
    max_rounds integer DEFAULT 1,
    evaluating_at timestamp with time zone,
    awarded_at timestamp with time zone,
    criteria text,
    submitted_by uuid,
    submitted_at timestamp with time zone,
    approved_by uuid,
    approved_at timestamp with time zone,
    approval_auto boolean DEFAULT false,
    approval_rejected_by uuid,
    approval_rejected_at timestamp with time zone,
    approval_rejection_reason text,
    phu_trach text,
    visibility text DEFAULT 'invited'::text,
    bid_deadline timestamp with time zone,
    deadline_round1 timestamp with time zone,
    deadline_round2 timestamp with time zone,
    deadline_round3 timestamp with time zone,
    rank_hint_enabled boolean DEFAULT false NOT NULL,
    rank_hint_round_from integer DEFAULT 9999 NOT NULL,
    sealed_until_deadline boolean DEFAULT false NOT NULL,
    award_status text DEFAULT 'none'::text NOT NULL,
    award_proposed_by uuid,
    award_proposed_at timestamp with time zone,
    award_approved_by uuid,
    award_approved_at timestamp with time zone,
    CONSTRAINT prfq_batch_award_status_chk CHECK ((award_status = ANY (ARRAY['none'::text, 'proposed'::text, 'approved'::text]))),
    CONSTRAINT prfq_batch_max_rounds_chk CHECK (((max_rounds >= 1) AND (max_rounds <= 3))),
    CONSTRAINT prfq_batch_visibility_chk CHECK ((visibility = ANY (ARRAY['invited'::text, 'open'::text]))),
    CONSTRAINT procurement_rfq_batches_award_mode_check CHECK ((award_mode = ANY (ARRAY['per_item'::text, 'per_batch'::text]))),
    CONSTRAINT procurement_rfq_batches_status_check3 CHECK ((status = ANY (ARRAY['draft'::text, 'cho_duyet'::text, 'approved'::text, 'rejected_internal'::text, 'published'::text, 'evaluating'::text, 'awarded'::text, 'closed'::text, 'cancelled'::text])))
);


--
-- Name: COLUMN procurement_rfq_batches.rank_hint_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.procurement_rfq_batches.rank_hint_enabled IS 'Đợt11 #15: bật gợi ý vị thế (band-mờ) cho NCC. Default OFF → /rank-hint trả 404. Thang bật per-batch.';


--
-- Name: COLUMN procurement_rfq_batches.rank_hint_round_from; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.procurement_rfq_batches.rank_hint_round_from IS 'Đợt11 #15: vòng nhỏ nhất được lộ band. Default 9999 = không vòng nào. Bật + show-mọi-vòng ⇒ set =1.';


--
-- Name: COLUMN procurement_rfq_batches.sealed_until_deadline; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.procurement_rfq_batches.sealed_until_deadline IS 'Đợt 2b: niêm phong đơn giá NCC trên mọi bề mặt admin tới khi qua bid_deadline (anti-leak). DEFAULT FALSE.';


--
-- Name: COLUMN procurement_rfq_batches.award_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.procurement_rfq_batches.award_status IS 'Đợt 3 maker-checker: none=chưa treo (finalize-ngay) | proposed=đề xuất chờ duyệt | approved=đã duyệt & finalize. DEFAULT none.';


--
-- Name: procurement_rfq_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_rfq_batches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_rfq_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_rfq_batches_id_seq OWNED BY public.procurement_rfq_batches.id;


--
-- Name: procurement_rfq_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_rfq_invitations (
    id bigint NOT NULL,
    batch_id bigint NOT NULL,
    vendor_id bigint NOT NULL,
    invited_at timestamp with time zone DEFAULT now() NOT NULL,
    viewed_at timestamp with time zone,
    quoted_at timestamp with time zone,
    email_sent boolean DEFAULT false,
    round_number integer DEFAULT 1,
    status text DEFAULT 'invited'::text,
    declined_at timestamp with time zone,
    decline_reason text,
    invited_by uuid,
    email_sent_at timestamp with time zone,
    email_status text,
    email_error text,
    email_subject text,
    reminder_sent_at timestamp with time zone,
    missed_deadline boolean DEFAULT false,
    CONSTRAINT prfq_inv_status_chk CHECK ((status = ANY (ARRAY['invited'::text, 'viewed'::text, 'submitted'::text, 'declined'::text])))
);


--
-- Name: procurement_rfq_invitations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_rfq_invitations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_rfq_invitations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_rfq_invitations_id_seq OWNED BY public.procurement_rfq_invitations.id;


--
-- Name: procurement_rfq_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_rfq_items (
    id bigint NOT NULL,
    batch_id bigint NOT NULL,
    item_no integer NOT NULL,
    specification text NOT NULL,
    bqms_code text,
    quantity numeric NOT NULL,
    unit text DEFAULT 'EA'::text NOT NULL,
    required_material text,
    drawing_url text,
    notes text,
    target_price numeric,
    source_bqms_rfq_id bigint,
    awarded_vendor_id bigint,
    awarded_price numeric,
    awarded_currency text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    drawing_filename text,
    images_paths jsonb DEFAULT '[]'::jsonb NOT NULL,
    maker text,
    part_no text,
    cis_code text,
    moq text,
    item_deadline date,
    dimension text,
    specification_full text,
    attachments_paths jsonb DEFAULT '[]'::jsonb NOT NULL,
    awarded_round integer,
    awarded_quote_item_id bigint,
    source_kind text DEFAULT 'manual'::text,
    source_ref_id bigint,
    item_code text,
    product_name text,
    model text,
    CONSTRAINT prfq_item_source_kind_chk CHECK ((source_kind = ANY (ARRAY['catalog'::text, 'paste'::text, 'manual'::text, 'bqms'::text, 'imv'::text, 'excel'::text])))
);


--
-- Name: procurement_rfq_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_rfq_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_rfq_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_rfq_items_id_seq OWNED BY public.procurement_rfq_items.id;


--
-- Name: procurement_rfq_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_rfq_messages (
    id bigint NOT NULL,
    batch_id bigint NOT NULL,
    vendor_id bigint,
    kind text NOT NULL,
    author_admin_id uuid,
    author_vendor_id bigint,
    body text NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    read_by_admin_at timestamp with time zone,
    read_by_vendor_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_rfq_msg_kind CHECK ((kind = ANY (ARRAY['question'::text, 'answer'::text, 'addendum'::text]))),
    CONSTRAINT chk_rfq_msg_scope CHECK ((((kind = 'addendum'::text) AND (vendor_id IS NULL) AND (author_admin_id IS NOT NULL) AND (author_vendor_id IS NULL)) OR ((kind = 'answer'::text) AND (vendor_id IS NOT NULL) AND (author_admin_id IS NOT NULL) AND (author_vendor_id IS NULL)) OR ((kind = 'question'::text) AND (vendor_id IS NOT NULL) AND (author_vendor_id IS NOT NULL) AND (author_admin_id IS NULL)))),
    CONSTRAINT chk_rfq_msg_vendor_self CHECK (((author_vendor_id IS NULL) OR (author_vendor_id = vendor_id)))
);


--
-- Name: TABLE procurement_rfq_messages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.procurement_rfq_messages IS 'Đợt 2a #12: Q&A per (batch,vendor) [question/answer] + Addendum broadcast [vendor_id NULL]. Không enum mới — notif tái dùng procurement_quote.';


--
-- Name: procurement_rfq_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_rfq_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_rfq_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_rfq_messages_id_seq OWNED BY public.procurement_rfq_messages.id;


--
-- Name: procurement_rfq_shared_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_rfq_shared_files (
    id bigint NOT NULL,
    batch_id bigint NOT NULL,
    item_id bigint NOT NULL,
    rfq_number text NOT NULL,
    kind text DEFAULT 'raw'::text NOT NULL,
    file_name text NOT NULL,
    shared_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT procurement_rfq_shared_files_kind_check CHECK ((kind = ANY (ARRAY['raw'::text, 'images'::text])))
);


--
-- Name: procurement_rfq_shared_files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_rfq_shared_files_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_rfq_shared_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_rfq_shared_files_id_seq OWNED BY public.procurement_rfq_shared_files.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id bigint NOT NULL,
    bqms_code text,
    imv_code text,
    customer_code text,
    product_name text NOT NULL,
    product_name_vi text,
    product_name_unaccent text GENERATED ALWAYS AS (public.immutable_unaccent(lower(product_name))) STORED,
    specification text,
    maker text,
    category text,
    material_type_id bigint,
    hs_code_id bigint,
    unit text DEFAULT 'EA'::text NOT NULL,
    country_origin text,
    weight_kg numeric(10,4),
    dimensions_l numeric(10,3),
    dimensions_w numeric(10,3),
    dimensions_h numeric(10,3),
    business_system public.business_system,
    image_path text,
    usage_location text,
    has_sample boolean,
    additional_info text,
    is_active boolean DEFAULT true NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_hash text,
    synced_at timestamp with time zone
);


--
-- Name: TABLE products; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.products IS 'San pham — ho tro ca BQMS va IMV, tim kiem khong dau';


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.products_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: profit_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profit_reports (
    id bigint NOT NULL,
    report_type text NOT NULL,
    period_start date,
    period_end date,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    calculated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profit_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.profit_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: profit_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.profit_reports_id_seq OWNED BY public.profit_reports.id;


--
-- Name: public_holidays_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.public_holidays_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: public_holidays_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.public_holidays_id_seq OWNED BY public.public_holidays.id;


--
-- Name: purchase_invoices_q; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_invoices_q (
    id bigint NOT NULL,
    quarter text NOT NULL,
    invoice_number text NOT NULL,
    invoice_date date NOT NULL,
    seller_name text NOT NULL,
    seller_tax_code text,
    item_name text,
    unit text,
    quantity numeric,
    unit_price numeric,
    amount_before_tax numeric,
    tax_rate text,
    tax_amount numeric,
    total_amount numeric,
    customer_code text,
    item_code text,
    issued_date date,
    source text DEFAULT 'manual'::text,
    pdf_path text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    shipping_cost numeric DEFAULT 0,
    customs_fee numeric DEFAULT 0,
    other_costs numeric DEFAULT 0,
    manual_adjustment numeric DEFAULT 0
);


--
-- Name: purchase_invoices_q_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_invoices_q_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_invoices_q_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_invoices_q_id_seq OWNED BY public.purchase_invoices_q.id;


--
-- Name: purchase_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_orders_id_seq OWNED BY public.purchase_orders.id;


--
-- Name: quotation_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotation_templates (
    id bigint NOT NULL,
    name text NOT NULL,
    description text,
    template_type text NOT NULL,
    file_path text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quotation_templates_template_type_check CHECK ((template_type = ANY (ARRAY['cam_ket'::text, 'commercial'::text, 'gc'::text, 'delivery_dossier'::text])))
);


--
-- Name: quotation_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quotation_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quotation_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quotation_templates_id_seq OWNED BY public.quotation_templates.id;


--
-- Name: quotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotations (
    id bigint NOT NULL,
    rfq_no text NOT NULL,
    quotation_no text,
    status text DEFAULT 'draft'::text NOT NULL,
    template_id bigint,
    source_type text DEFAULT 'excel'::text NOT NULL,
    source_file text,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    output_xlsx text,
    output_pdf text,
    total_items integer DEFAULT 0 NOT NULL,
    filled_items integer DEFAULT 0 NOT NULL,
    error_message text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    flow_type text DEFAULT 'tm'::text NOT NULL,
    quote_level smallint,
    gc_source_folder text,
    gc_cloned_folder text,
    gc_sheet_report jsonb,
    deleted_at timestamp with time zone,
    onedrive_folder_id text,
    onedrive_url text,
    onedrive_share_url text,
    onedrive_synced_at timestamp with time zone,
    onedrive_sync_error text,
    CONSTRAINT quotations_flow_type_check CHECK ((flow_type = ANY (ARRAY['tm'::text, 'gc'::text]))),
    CONSTRAINT quotations_source_type_check CHECK ((source_type = ANY (ARRAY['excel'::text, 'rfq_code'::text, 'ai_classify'::text, 'onedrive'::text]))),
    CONSTRAINT quotations_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'submitted'::text])))
);


--
-- Name: COLUMN quotations.flow_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quotations.flow_type IS 'tm = Thương Mại (template fill), gc = Gia Công (marker fill)';


--
-- Name: COLUMN quotations.quote_level; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quotations.quote_level IS 'L1=1, L2=2, L3=3, L4=4 — chỉ dùng cho GC flow';


--
-- Name: COLUMN quotations.gc_source_folder; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quotations.gc_source_folder IS 'Đường dẫn thư mục Lx gốc trên OneDrive staging';


--
-- Name: COLUMN quotations.gc_cloned_folder; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quotations.gc_cloned_folder IS 'Đường dẫn thư mục Lx+1 đã clone và sửa';


--
-- Name: COLUMN quotations.gc_sheet_report; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quotations.gc_sheet_report IS 'Báo cáo sửa từng sheet: [{sheet, code, price, status, marker_row}]';


--
-- Name: COLUMN quotations.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quotations.deleted_at IS 'Soft-delete: NULL = active. Set = ẩn khỏi list (file giữ trên disk để khôi phục).';


--
-- Name: COLUMN quotations.onedrive_folder_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quotations.onedrive_folder_id IS 'Microsoft Graph driveItem id của folder chứa CAM_KET + QUOTATION';


--
-- Name: COLUMN quotations.onedrive_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quotations.onedrive_url IS 'Web URL của file QUOTATION PDF chính trên OneDrive — click để mở Office Online';


--
-- Name: COLUMN quotations.onedrive_share_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quotations.onedrive_share_url IS 'Share link M365 (ai có link đều xem được, có thể truy cập từ ngoài)';


--
-- Name: COLUMN quotations.onedrive_synced_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quotations.onedrive_synced_at IS 'Timestamp upload OneDrive thành công gần nhất. NULL = chưa sync hoặc lỗi';


--
-- Name: quotations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quotations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quotations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quotations_id_seq OWNED BY public.quotations.id;


--
-- Name: quote_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quote_batches (
    id bigint NOT NULL,
    quote_no text NOT NULL,
    customer_id bigint,
    customer_name text,
    quote_note text,
    total_items integer DEFAULT 0 NOT NULL,
    total_value_vnd numeric(20,2) DEFAULT 0 NOT NULL,
    item_ids bigint[] NOT NULL,
    line_items jsonb,
    file_path text,
    file_format text,
    sent_at timestamp with time zone,
    sent_to_email text,
    created_by_id bigint,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    doc_category text DEFAULT 'bao_gia'::text NOT NULL,
    valid_until date,
    deleted_at timestamp with time zone,
    quote_group_id bigint,
    version_no integer DEFAULT 1 NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    converted_order_id bigint,
    CONSTRAINT quote_batches_file_format_check CHECK ((file_format = ANY (ARRAY['xlsx'::text, 'pdf'::text, 'tsv'::text]))),
    CONSTRAINT quote_batches_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'rejected'::text, 'expired'::text])))
);


--
-- Name: TABLE quote_batches; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.quote_batches IS 'Báo giá hàng loạt từ /sourcing. 1 record = 1 lần user tick + tạo file XLSX.';


--
-- Name: COLUMN quote_batches.item_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quote_batches.item_ids IS 'Snapshot sourcing_entries.id[] tại thời điểm tạo. KHÔNG cascade khi sourcing row bị xóa.';


--
-- Name: COLUMN quote_batches.line_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quote_batches.line_items IS 'Snapshot dữ liệu hiển trong báo giá. Dùng để regenerate file mà không cần JOIN sourcing.';


--
-- Name: quote_batches_daily_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quote_batches_daily_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quote_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quote_batches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quote_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quote_batches_id_seq OWNED BY public.quote_batches.id;


--
-- Name: report_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_executions (
    id bigint NOT NULL,
    schedule_id bigint,
    report_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    file_path text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT report_executions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'success'::text, 'error'::text])))
);


--
-- Name: report_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.report_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: report_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.report_executions_id_seq OWNED BY public.report_executions.id;


--
-- Name: retry_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retry_queue (
    id bigint NOT NULL,
    job_type text NOT NULL,
    job_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    last_error text,
    next_retry_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT retry_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'retrying'::text, 'completed'::text, 'failed_permanently'::text])))
);


--
-- Name: retry_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.retry_queue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: retry_queue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.retry_queue_id_seq OWNED BY public.retry_queue.id;


--
-- Name: revenue_chain_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.revenue_chain_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: SEQUENCE revenue_chain_code_seq; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON SEQUENCE public.revenue_chain_code_seq IS 'Phase 3 — atomic source of the RC-YYYYMM-NNNNNN chain-code numeric suffix (used by chain_service.gen_chain_code via nextval). Replaces the unsafe MAX(id)+1 race. NO CYCLE — suffixes are monotonic and never re-collide.';


--
-- Name: revenue_chain_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.revenue_chain_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: revenue_chain_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.revenue_chain_id_seq OWNED BY public.revenue_chain.id;


--
-- Name: revenue_invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.revenue_invoices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: revenue_invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.revenue_invoices_id_seq OWNED BY public.revenue_invoices.id;


--
-- Name: rfq_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rfq_line_items (
    id bigint NOT NULL,
    rfq_id bigint NOT NULL,
    product_id bigint,
    product_code text,
    product_name text NOT NULL,
    specification text,
    maker text,
    quantity numeric(12,3) NOT NULL,
    unit text DEFAULT 'EA'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE rfq_line_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.rfq_line_items IS 'Chi tiet dong yeu cau bao gia';


--
-- Name: rfq_line_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rfq_line_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rfq_line_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rfq_line_items_id_seq OWNED BY public.rfq_line_items.id;


--
-- Name: rfq_quotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rfq_quotations (
    id bigint NOT NULL,
    rfq_id bigint NOT NULL,
    supplier_id bigint NOT NULL,
    unit_price numeric(15,4),
    currency public.currency_code DEFAULT 'USD'::public.currency_code,
    lead_time_days smallint,
    validity_date date,
    terms text,
    is_selected boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE rfq_quotations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.rfq_quotations IS 'Bao gia tu NCC — moi NCC 1 bao gia cho 1 RFQ';


--
-- Name: rfq_quotations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rfq_quotations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rfq_quotations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rfq_quotations_id_seq OWNED BY public.rfq_quotations.id;


--
-- Name: rfq_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rfq_requests (
    id bigint NOT NULL,
    rfq_number text NOT NULL,
    title text NOT NULL,
    description text,
    deadline date NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    business_system public.business_system,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rfq_requests_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'received'::text, 'selected'::text, 'cancelled'::text])))
);


--
-- Name: TABLE rfq_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.rfq_requests IS 'Yeu cau bao gia noi bo — gui cho nhieu NCC';


--
-- Name: rfq_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rfq_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rfq_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rfq_requests_id_seq OWNED BY public.rfq_requests.id;


--
-- Name: sales_invoices_q; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_invoices_q (
    id bigint NOT NULL,
    quarter text NOT NULL,
    invoice_number text NOT NULL,
    invoice_date date NOT NULL,
    buyer_name text NOT NULL,
    buyer_tax_code text,
    item_name text,
    unit text,
    quantity numeric,
    unit_price numeric,
    amount_before_tax numeric,
    tax_rate text,
    tax_amount numeric,
    total_amount numeric,
    supplier_name text,
    cost_price numeric,
    cost_vat numeric,
    source text DEFAULT 'manual'::text,
    pdf_path text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    shipping_cost numeric DEFAULT 0,
    customs_fee numeric DEFAULT 0,
    commission numeric DEFAULT 0,
    other_costs numeric DEFAULT 0,
    manual_adjustment numeric DEFAULT 0
);


--
-- Name: sales_invoices_q_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_invoices_q_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_invoices_q_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_invoices_q_id_seq OWNED BY public.sales_invoices_q.id;


--
-- Name: sales_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_order_items (
    id bigint NOT NULL,
    sales_order_id bigint NOT NULL,
    line_number smallint NOT NULL,
    product_id bigint,
    product_code text,
    product_name text NOT NULL,
    specification text,
    unit text DEFAULT 'EA'::text,
    quantity numeric(12,3) NOT NULL,
    unit_price numeric(15,4) NOT NULL,
    amount numeric(15,2),
    vat_rate numeric(5,2) DEFAULT 10,
    delivered_qty numeric(12,3) DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_order_items_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: TABLE sales_order_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sales_order_items IS 'Chi tiet dong don ban hang';


--
-- Name: sales_order_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_order_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_order_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_order_items_id_seq OWNED BY public.sales_order_items.id;


--
-- Name: sales_order_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_order_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_orders_id_seq OWNED BY public.sales_orders.id;


--
-- Name: samsung_watchdog_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.samsung_watchdog_events (
    id bigint NOT NULL,
    event_type text NOT NULL,
    reference_no text,
    bqms_code text,
    details jsonb,
    is_processed boolean DEFAULT false,
    processed_by uuid,
    processed_at timestamp with time zone,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT samsung_watchdog_events_event_type_check CHECK ((event_type = ANY (ARRAY['new_rfq'::text, 'new_po'::text, 'status_change'::text, 'deadline_alert'::text])))
);


--
-- Name: samsung_watchdog_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.samsung_watchdog_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: samsung_watchdog_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.samsung_watchdog_events_id_seq OWNED BY public.samsung_watchdog_events.id;


--
-- Name: scheduled_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_reports (
    id bigint NOT NULL,
    report_type text NOT NULL,
    report_name text NOT NULL,
    schedule_cron text NOT NULL,
    recipients text[] DEFAULT '{}'::text[] NOT NULL,
    email_subject text,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scheduled_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scheduled_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scheduled_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scheduled_reports_id_seq OWNED BY public.scheduled_reports.id;


--
-- Name: security_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_log (
    id bigint NOT NULL,
    event_type text NOT NULL,
    user_id uuid,
    ip_address inet,
    user_agent text,
    details jsonb DEFAULT '{}'::jsonb,
    severity text DEFAULT 'info'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT security_log_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])))
);


--
-- Name: security_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.security_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: security_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.security_log_id_seq OWNED BY public.security_log.id;


--
-- Name: shipment_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment_items (
    id bigint NOT NULL,
    shipment_id bigint NOT NULL,
    po_line_id bigint,
    product_id bigint,
    bqms_code text,
    description text,
    quantity_shipped numeric(12,3) NOT NULL,
    quantity_received numeric(12,3),
    unit text DEFAULT 'EA'::text NOT NULL,
    unit_price_cny numeric(14,4),
    line_total_cny numeric(14,2),
    weight_kg numeric(10,3),
    cbm numeric(8,3),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shipment_items_quantity_shipped_check CHECK ((quantity_shipped > (0)::numeric))
);


--
-- Name: shipment_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shipment_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shipment_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shipment_items_id_seq OWNED BY public.shipment_items.id;


--
-- Name: shipments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipments (
    id bigint NOT NULL,
    shipment_number text NOT NULL,
    po_id bigint NOT NULL,
    supplier_id bigint NOT NULL,
    chain_code text,
    status text DEFAULT 'pending'::text NOT NULL,
    origin_country text DEFAULT 'CN'::text NOT NULL,
    incoterm text DEFAULT 'FOB'::text,
    carrier text,
    tracking_number text,
    bill_of_lading text,
    container_number text,
    origin_port text,
    dest_port text DEFAULT 'Cảng Hải Phòng'::text,
    etd date,
    atd date,
    eta date,
    ata date,
    received_at timestamp with time zone,
    total_weight_kg numeric(10,3),
    total_cbm numeric(8,3),
    freight_cost_usd numeric(12,2),
    customs_duty_vnd numeric(14,2),
    other_costs_vnd numeric(14,2),
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shipments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_transit'::text, 'arrived_port'::text, 'customs_clearance'::text, 'received'::text, 'cancelled'::text])))
);


--
-- Name: shipments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shipments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shipments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shipments_id_seq OWNED BY public.shipments.id;


--
-- Name: sourcing_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_entries (
    id bigint NOT NULL,
    bqms_code text,
    customer_name text,
    person_in_charge text,
    model text,
    product_name text,
    maker text,
    inquiry_date date,
    cost_jpy numeric(18,2),
    cost_usd numeric(18,2),
    cost_krw numeric(18,2),
    cost_rmb numeric(18,2),
    cost_vnd numeric(18,0),
    sale_vnd numeric(18,0),
    quantity numeric(18,3),
    tax_pct numeric(6,2),
    hs_code text,
    weight_kg numeric(12,3),
    coefficient numeric(8,4),
    supplier_name text,
    supplier_phone text,
    supplier_email text,
    image_url text,
    notes text,
    row_classification text,
    exchange_rate jsonb,
    created_by_id bigint,
    created_by_email text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    catalog_category text,
    brand_canonical text,
    part_type text,
    subcategory_slug text,
    machine_model text,
    internal_part_no text,
    normalized_model text,
    catalog_status text,
    stage smallint,
    missing_fields text[],
    missing_count smallint DEFAULT 0,
    customer_id bigint,
    deleted_at timestamp with time zone,
    notes_internal text,
    model_norm text GENERATED ALWAYS AS (regexp_replace(upper(COALESCE(model, ''::text)), '[^A-Z0-9]'::text, ''::text, 'g'::text)) STORED,
    updated_by_id bigint,
    updated_by_email text,
    fx_rate_snapshot numeric,
    fx_rate_date date,
    quote_snapshot jsonb,
    fedex_fee_vnd numeric(18,0),
    vn_shipping_fee_vnd numeric(18,0),
    CONSTRAINT sourcing_entries_catalog_status_check CHECK (((catalog_status IS NULL) OR (catalog_status = ANY (ARRAY['OK'::text, 'NEEDS_BRAND'::text, 'NOT_IN_CATALOG'::text, 'PRODUCT_CANDIDATE'::text])))),
    CONSTRAINT sourcing_entries_stage_check CHECK (((stage IS NULL) OR (stage = ANY (ARRAY[1, 2, 3]))))
);


--
-- Name: COLUMN sourcing_entries.catalog_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_entries.catalog_status IS 'OK=có đủ thông tin / NEEDS_BRAND=thiếu brand / NOT_IN_CATALOG=mã rời rạc / PRODUCT_CANDIDATE=chưa enrich';


--
-- Name: COLUMN sourcing_entries.stage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_entries.stage IS '1=raw RFQ, 2=enriched, 3=ready để gửi báo giá';


--
-- Name: COLUMN sourcing_entries.missing_fields; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_entries.missing_fields IS 'TEXT[] tên các field còn trống — auto-compute lúc INSERT/UPDATE';


--
-- Name: COLUMN sourcing_entries.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_entries.deleted_at IS 'Soft-delete. NULL = active. Filtered ra khỏi mọi index.';


--
-- Name: COLUMN sourcing_entries.model_norm; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_entries.model_norm IS 'GENERATED: UPPER + strip non-alphanumeric. Dùng cho bulk-lookup exact match.';


--
-- Name: COLUMN sourcing_entries.quote_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_entries.quote_snapshot IS 'Frozen pricing context captured at "Áp dụng giá báo" (Batch #1, 2026-06-27). Shape: {unit_price_vnd, qty, source:auto|manual, supplier_price_id, fx_rate, fx_date, is_domestic, fedex_fee_vnd, vn_shipping_fee_vnd, pct_overrides:{importTax,vat,purchase,profit}, breakdown:{I,K,L,M,N,O,P,Q,R,S,T}, params, computed_at}. Reopening an entry restores the form inputs from this; the quote modal defaults its per-line price to unit_price_vnd.';


--
-- Name: COLUMN sourcing_entries.fedex_fee_vnd; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_entries.fedex_fee_vnd IS 'Phí vận chuyển quốc tế (FedEx) VND — dùng để tính giá + khôi phục form khi mở lại. Đảo quyết định cũ "chỉ history" vì cần reopen không phụ thuộc quote_snapshot.';


--
-- Name: COLUMN sourcing_entries.vn_shipping_fee_vnd; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_entries.vn_shipping_fee_vnd IS 'Phí vận chuyển nội địa VN (VND) — cột nguồn để reopen; sourcing_vn_shipping_history vẫn được append để giữ lịch sử thay đổi.';


--
-- Name: sourcing_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sourcing_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sourcing_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sourcing_entries_id_seq OWNED BY public.sourcing_entries.id;


--
-- Name: sourcing_order_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_order_status_history (
    id bigint NOT NULL,
    order_id bigint NOT NULL,
    from_status text,
    status text NOT NULL,
    by_user_id uuid,
    by_user_email text,
    by_user_name text,
    note text,
    metadata jsonb,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sourcing_order_status_history_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'quoted'::text, 'confirmed'::text, 'payment_requested'::text, 'payment_approved'::text, 'shipped'::text, 'delivered'::text, 'cancelled'::text])))
);


--
-- Name: TABLE sourcing_order_status_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_order_status_history IS 'Append-only timeline. Render UI Timeline component sort by `at DESC`.';


--
-- Name: sourcing_order_status_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sourcing_order_status_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sourcing_order_status_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sourcing_order_status_history_id_seq OWNED BY public.sourcing_order_status_history.id;


--
-- Name: sourcing_order_status_history_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_order_status_history_archive (
    id bigint DEFAULT nextval('public.sourcing_order_status_history_id_seq'::regclass) NOT NULL,
    order_id bigint NOT NULL,
    from_status text,
    status text NOT NULL,
    by_user_id uuid,
    by_user_email text,
    by_user_name text,
    note text,
    metadata jsonb,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sourcing_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_orders (
    id bigint NOT NULL,
    order_number text NOT NULL,
    sourcing_entry_ids bigint[] DEFAULT '{}'::bigint[] NOT NULL,
    source_type text DEFAULT 'sourcing'::text NOT NULL,
    source_ref_id bigint,
    source_ref_no text,
    customer_id bigint,
    customer_name text NOT NULL,
    customer_contact text,
    customer_email text,
    customer_phone text,
    customer_address text,
    person_in_charge text,
    order_date date DEFAULT CURRENT_DATE NOT NULL,
    delivery_date date,
    payment_terms text,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    subtotal_vnd numeric(18,0) DEFAULT 0 NOT NULL,
    tax_vnd numeric(18,0) DEFAULT 0 NOT NULL,
    shipping_fee_vnd numeric(18,0) DEFAULT 0 NOT NULL,
    discount_vnd numeric(18,0) DEFAULT 0 NOT NULL,
    total_value_vnd numeric(18,0) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'VND'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    quote_pdf_url text,
    quote_pdf_version integer DEFAULT 0 NOT NULL,
    quote_sent_at timestamp with time zone,
    quote_sent_to text[],
    payment_request_id bigint,
    sales_order_id bigint,
    invoice_id bigint,
    assigned_to uuid,
    created_by_id bigint,
    created_by_email text,
    updated_by_id bigint,
    updated_by_email text,
    notes text,
    internal_notes text,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    chain_code text,
    samsung_po_number text,
    accounts_receivable_id bigint,
    CONSTRAINT chk_so_discount_le_subtotal CHECK (((discount_vnd IS NULL) OR ((subtotal_vnd IS NOT NULL) AND (discount_vnd <= subtotal_vnd)))),
    CONSTRAINT sourcing_orders_source_type_check CHECK ((source_type = ANY (ARRAY['sourcing'::text, 'manual'::text, 'bqms_po'::text, 'imv_po'::text, 'quote_batch'::text]))),
    CONSTRAINT sourcing_orders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'quoted'::text, 'confirmed'::text, 'payment_requested'::text, 'payment_approved'::text, 'shipped'::text, 'delivered'::text, 'cancelled'::text])))
);


--
-- Name: TABLE sourcing_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_orders IS 'Quote-to-order pipeline trên Sourcing Library. Draft -> Quoted -> Confirmed -> Payment -> Shipped -> Delivered.';


--
-- Name: COLUMN sourcing_orders.sourcing_entry_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_orders.sourcing_entry_ids IS 'Mảng ID nguồn để trace ngược. GIN index cho query "đơn nào dùng entry X".';


--
-- Name: COLUMN sourcing_orders.line_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_orders.line_items IS 'JSONB snapshot mỗi line tại thời điểm tạo order. KHÔNG join lại sourcing_entries vì giá có thể thay đổi.';


--
-- Name: sourcing_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sourcing_orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sourcing_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sourcing_orders_id_seq OWNED BY public.sourcing_orders.id;


--
-- Name: sourcing_orders_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sourcing_orders_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sourcing_pricing_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_pricing_rules (
    id bigint NOT NULL,
    item_type text NOT NULL,
    markup_pct numeric(6,3) DEFAULT 1.400 NOT NULL,
    tax_pct numeric(6,3) DEFAULT 10.000 NOT NULL,
    shipping_fee_vnd numeric(18,2) DEFAULT 0,
    description_vi text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    import_tax_pct numeric(6,3) DEFAULT 20.000 NOT NULL,
    vat_pct numeric(6,3) DEFAULT 10.000 NOT NULL,
    purchase_cost_pct numeric(6,3) DEFAULT 25.000 NOT NULL,
    transfer_fee_pct numeric(6,3) DEFAULT 0.200 NOT NULL,
    swift_fee_usd numeric(10,3) DEFAULT 5.000 NOT NULL,
    profit_pct_import numeric(6,3) DEFAULT 12.000 NOT NULL,
    profit_pct_domestic numeric(6,3) DEFAULT 20.000 NOT NULL,
    created_by_id bigint,
    created_by_email text,
    updated_by_id bigint,
    updated_by_email text,
    CONSTRAINT spr_chk_import_tax_pct_cap CHECK ((import_tax_pct <= (1000)::numeric)),
    CONSTRAINT spr_chk_import_tax_pct_nonneg CHECK ((import_tax_pct >= (0)::numeric)),
    CONSTRAINT spr_chk_markup_pct_nonneg CHECK ((markup_pct >= (0)::numeric)),
    CONSTRAINT spr_chk_profit_pct_domestic_cap CHECK ((profit_pct_domestic <= (1000)::numeric)),
    CONSTRAINT spr_chk_profit_pct_domestic_nonneg CHECK ((profit_pct_domestic >= (0)::numeric)),
    CONSTRAINT spr_chk_profit_pct_import_cap CHECK ((profit_pct_import <= (1000)::numeric)),
    CONSTRAINT spr_chk_profit_pct_import_nonneg CHECK ((profit_pct_import >= (0)::numeric)),
    CONSTRAINT spr_chk_purchase_cost_pct_cap CHECK ((purchase_cost_pct <= (1000)::numeric)),
    CONSTRAINT spr_chk_purchase_cost_pct_nonneg CHECK ((purchase_cost_pct >= (0)::numeric)),
    CONSTRAINT spr_chk_shipping_fee_nonneg CHECK ((shipping_fee_vnd >= (0)::numeric)),
    CONSTRAINT spr_chk_swift_fee_usd_nonneg CHECK ((swift_fee_usd >= (0)::numeric)),
    CONSTRAINT spr_chk_tax_pct_nonneg CHECK ((tax_pct >= (0)::numeric)),
    CONSTRAINT spr_chk_transfer_fee_pct_cap CHECK ((transfer_fee_pct <= (100)::numeric)),
    CONSTRAINT spr_chk_transfer_fee_pct_nonneg CHECK ((transfer_fee_pct >= (0)::numeric)),
    CONSTRAINT spr_chk_vat_pct_cap CHECK ((vat_pct <= (1000)::numeric)),
    CONSTRAINT spr_chk_vat_pct_nonneg CHECK ((vat_pct >= (0)::numeric))
);


--
-- Name: TABLE sourcing_pricing_rules; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_pricing_rules IS 'Quy tắc tính giá bán theo item_type — engine compute_sale_vnd() lookup table';


--
-- Name: COLUMN sourcing_pricing_rules.markup_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_pricing_rules.markup_pct IS 'Hệ số nhân (1.4 = +40%) — KHÁC với percentage (40%)';


--
-- Name: COLUMN sourcing_pricing_rules.tax_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_pricing_rules.tax_pct IS 'VAT % — 10 = 10%, KHÔNG phải 0.1';


--
-- Name: COLUMN sourcing_pricing_rules.import_tax_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_pricing_rules.import_tax_pct IS 'Thuế nhập khẩu % (N = (K+M) * import_tax_pct/100). Set 0 khi is_domestic_vn.';


--
-- Name: COLUMN sourcing_pricing_rules.vat_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_pricing_rules.vat_pct IS 'Thuế VAT % (O = (K+M+N) * vat_pct/100). Default 10%.';


--
-- Name: COLUMN sourcing_pricing_rules.purchase_cost_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_pricing_rules.purchase_cost_pct IS 'Chi phí mua hộ % (P = K * purchase_cost_pct/100). Default 25%.';


--
-- Name: COLUMN sourcing_pricing_rules.transfer_fee_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_pricing_rules.transfer_fee_pct IS 'Phí chuyển tiền % (Q phần 1 = (K+M+P) * transfer_fee_pct/100). Default 0.2%.';


--
-- Name: COLUMN sourcing_pricing_rules.swift_fee_usd; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_pricing_rules.swift_fee_usd IS 'Phí Swift USD (Q phần 2 = swift_fee_usd * USD-VND rate). Default 5 USD.';


--
-- Name: COLUMN sourcing_pricing_rules.profit_pct_import; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_pricing_rules.profit_pct_import IS 'Lợi nhuận % cho hàng nhập khẩu (R = (K+L+M+N+O+P+Q) * profit_pct_import/100). Default 12%.';


--
-- Name: COLUMN sourcing_pricing_rules.profit_pct_domestic; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_pricing_rules.profit_pct_domestic IS 'Lợi nhuận % cho hàng nội địa VN (R = ... * profit_pct_domestic/100). Default 20%.';


--
-- Name: sourcing_pricing_rules_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_pricing_rules_history (
    id bigint NOT NULL,
    rule_item_type text NOT NULL,
    old_values jsonb NOT NULL,
    new_values jsonb NOT NULL,
    changed_at timestamp with time zone DEFAULT now(),
    changed_by_id bigint,
    changed_by_email text,
    change_summary text
);


--
-- Name: TABLE sourcing_pricing_rules_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_pricing_rules_history IS 'Audit ledger cho sourcing_pricing_rules — mỗi upsert insert 1 row với old/new JSONB diff';


--
-- Name: COLUMN sourcing_pricing_rules_history.old_values; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_pricing_rules_history.old_values IS 'Snapshot toàn bộ row trước UPDATE — {} nếu là INSERT (rule mới)';


--
-- Name: COLUMN sourcing_pricing_rules_history.new_values; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_pricing_rules_history.new_values IS 'Snapshot toàn bộ row sau UPSERT';


--
-- Name: COLUMN sourcing_pricing_rules_history.change_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_pricing_rules_history.change_summary IS 'Tóm tắt thay đổi dạng "markup_pct: 1.4 -> 1.5; tax_pct: 10 -> 8" — render nhanh ở UI';


--
-- Name: sourcing_pricing_rules_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sourcing_pricing_rules_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sourcing_pricing_rules_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sourcing_pricing_rules_history_id_seq OWNED BY public.sourcing_pricing_rules_history.id;


--
-- Name: sourcing_pricing_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sourcing_pricing_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sourcing_pricing_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sourcing_pricing_rules_id_seq OWNED BY public.sourcing_pricing_rules.id;


--
-- Name: sourcing_pricing_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_pricing_snapshots (
    id bigint NOT NULL,
    entry_id bigint NOT NULL,
    version integer NOT NULL,
    snapshot jsonb NOT NULL,
    sale_vnd numeric(18,0),
    label text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_email text
);


--
-- Name: sourcing_pricing_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sourcing_pricing_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sourcing_pricing_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sourcing_pricing_snapshots_id_seq OWNED BY public.sourcing_pricing_snapshots.id;


--
-- Name: sourcing_supplier_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_supplier_prices (
    id bigint NOT NULL,
    sourcing_entry_id bigint NOT NULL,
    supplier_name text NOT NULL,
    supplier_phone text,
    supplier_email text,
    currency text DEFAULT 'VND'::text NOT NULL,
    cost_amount numeric(18,4) NOT NULL,
    cost_vnd_equiv numeric(18,2),
    exchange_rate_used numeric(18,6),
    lead_time_days integer,
    moq integer,
    notes text,
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by_id bigint,
    created_by_email text,
    updated_by_id bigint,
    updated_by_email text,
    CONSTRAINT chk_ssp_currency CHECK ((currency = ANY (ARRAY['VND'::text, 'JPY'::text, 'USD'::text, 'KRW'::text, 'RMB'::text, 'EUR'::text])))
);


--
-- Name: TABLE sourcing_supplier_prices; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sourcing_supplier_prices IS 'Bảng đa NCC cho 1 sourcing_entry — sale so sánh giá nhập + chọn primary';


--
-- Name: COLUMN sourcing_supplier_prices.cost_vnd_equiv; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_supplier_prices.cost_vnd_equiv IS 'cost_amount * exchange_rate_used, cache tại thời điểm lưu (snapshot)';


--
-- Name: COLUMN sourcing_supplier_prices.is_primary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_supplier_prices.is_primary IS 'NCC chính — chỉ 1 per entry (partial unique idx_ssp_one_primary)';


--
-- Name: COLUMN sourcing_supplier_prices.created_by_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_supplier_prices.created_by_email IS 'Snapshot of token_data.email at create time — survives user-delete';


--
-- Name: COLUMN sourcing_supplier_prices.updated_by_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sourcing_supplier_prices.updated_by_email IS 'Snapshot of token_data.email at last update — for forensic audit';


--
-- Name: sourcing_supplier_prices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sourcing_supplier_prices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sourcing_supplier_prices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sourcing_supplier_prices_id_seq OWNED BY public.sourcing_supplier_prices.id;


--
-- Name: sourcing_vn_shipping_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_vn_shipping_history (
    id bigint NOT NULL,
    entry_id bigint NOT NULL,
    value_vnd numeric(18,0) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_email text
);


--
-- Name: sourcing_vn_shipping_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sourcing_vn_shipping_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sourcing_vn_shipping_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sourcing_vn_shipping_history_id_seq OWNED BY public.sourcing_vn_shipping_history.id;


--
-- Name: stock_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_alerts (
    id bigint NOT NULL,
    product_id bigint NOT NULL,
    alert_type text NOT NULL,
    current_qty numeric(14,3) NOT NULL,
    threshold_qty numeric(14,3) NOT NULL,
    suggested_order_qty numeric(14,3),
    status text DEFAULT 'active'::text NOT NULL,
    acknowledged_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_alerts_alert_type_check CHECK ((alert_type = ANY (ARRAY['low_stock'::text, 'out_of_stock'::text, 'overstock'::text, 'reorder_suggested'::text]))),
    CONSTRAINT stock_alerts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'acknowledged'::text, 'resolved'::text])))
);


--
-- Name: stock_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_alerts_id_seq OWNED BY public.stock_alerts.id;


--
-- Name: supplier_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_contracts (
    id bigint NOT NULL,
    supplier_id bigint NOT NULL,
    contract_number text,
    title text NOT NULL,
    start_date date NOT NULL,
    end_date date,
    payment_terms text,
    incoterms text,
    default_currency public.currency_code DEFAULT 'USD'::public.currency_code,
    status text DEFAULT 'active'::text NOT NULL,
    document_path text,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_contracts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'expired'::text, 'terminated'::text])))
);


--
-- Name: TABLE supplier_contracts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.supplier_contracts IS 'Hop dong khung voi nha cung cap';


--
-- Name: supplier_contracts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.supplier_contracts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: supplier_contracts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.supplier_contracts_id_seq OWNED BY public.supplier_contracts.id;


--
-- Name: supplier_product_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_product_map (
    id bigint NOT NULL,
    supplier_id bigint NOT NULL,
    bqms_code text NOT NULL,
    product_id bigint,
    typical_lead_time_days integer,
    typical_moq numeric(12,3),
    typical_price_cny numeric(14,4),
    currency text DEFAULT 'CNY'::text NOT NULL,
    last_quoted_at timestamp with time zone,
    quality_score numeric(3,2),
    is_preferred boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_product_map_quality_score_check CHECK (((quality_score >= (0)::numeric) AND (quality_score <= (5)::numeric)))
);


--
-- Name: supplier_product_map_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.supplier_product_map_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: supplier_product_map_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.supplier_product_map_id_seq OWNED BY public.supplier_product_map.id;


--
-- Name: supplier_quote_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_quote_items (
    id bigint NOT NULL,
    quote_id bigint NOT NULL,
    line_number integer NOT NULL,
    bqms_code text NOT NULL,
    product_id bigint,
    description text,
    specification text,
    maker text,
    quantity numeric(12,3) NOT NULL,
    unit text DEFAULT 'EA'::text NOT NULL,
    unit_price_cny numeric(14,4),
    unit_price_vnd numeric(14,2),
    line_total_cny numeric(14,2),
    line_total_vnd numeric(14,2),
    samsung_sell_price_vnd numeric(14,2),
    margin_pct numeric(5,2),
    lead_time_days integer,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_quote_items_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: supplier_quote_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.supplier_quote_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: supplier_quote_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.supplier_quote_items_id_seq OWNED BY public.supplier_quote_items.id;


--
-- Name: supplier_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_quotes (
    id bigint NOT NULL,
    quote_number text NOT NULL,
    supplier_id bigint NOT NULL,
    rfq_id bigint,
    sales_order_id bigint,
    chain_code text,
    status text DEFAULT 'requested'::text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    received_at timestamp with time zone,
    valid_until date,
    currency text DEFAULT 'CNY'::text NOT NULL,
    exchange_rate numeric(10,4),
    total_amount_cny numeric(14,2),
    total_amount_vnd numeric(16,2),
    lead_time_days integer,
    payment_terms text,
    incoterm text DEFAULT 'FOB'::text,
    rejection_reason text,
    needs_review boolean DEFAULT false NOT NULL,
    margin_pct numeric(5,2),
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_quotes_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'received'::text, 'accepted'::text, 'rejected'::text, 'expired'::text])))
);


--
-- Name: supplier_quotes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.supplier_quotes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: supplier_quotes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.supplier_quotes_id_seq OWNED BY public.supplier_quotes.id;


--
-- Name: supplier_ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_ratings (
    id bigint NOT NULL,
    supplier_id bigint NOT NULL,
    period_year integer NOT NULL,
    period_quarter integer NOT NULL,
    total_orders integer DEFAULT 0 NOT NULL,
    on_time_orders integer DEFAULT 0 NOT NULL,
    quality_rejects integer DEFAULT 0 NOT NULL,
    avg_lead_time_days numeric(6,2),
    on_time_rate numeric(5,2) GENERATED ALWAYS AS (
CASE
    WHEN (total_orders = 0) THEN (0)::numeric
    ELSE round((((on_time_orders)::numeric / (total_orders)::numeric) * (100)::numeric), 2)
END) STORED,
    quality_rate numeric(5,2) GENERATED ALWAYS AS (
CASE
    WHEN (total_orders = 0) THEN (100)::numeric
    ELSE round((((1)::numeric - ((quality_rejects)::numeric / (NULLIF(total_orders, 0))::numeric)) * (100)::numeric), 2)
END) STORED,
    composite_score numeric(3,2),
    notes text,
    calculated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_ratings_composite_score_check CHECK (((composite_score >= (0)::numeric) AND (composite_score <= (5)::numeric))),
    CONSTRAINT supplier_ratings_period_quarter_check CHECK (((period_quarter >= 1) AND (period_quarter <= 4)))
);


--
-- Name: supplier_ratings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.supplier_ratings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: supplier_ratings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.supplier_ratings_id_seq OWNED BY public.supplier_ratings.id;


--
-- Name: supplier_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_scores (
    id bigint NOT NULL,
    supplier_id bigint NOT NULL,
    score_date date NOT NULL,
    price_score numeric(5,2),
    quality_score numeric(5,2),
    delivery_score numeric(5,2),
    response_score numeric(5,2),
    overall_score numeric(5,2),
    ranking integer,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: supplier_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.supplier_scores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: supplier_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.supplier_scores_id_seq OWNED BY public.supplier_scores.id;


--
-- Name: suppliers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.suppliers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: suppliers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.suppliers_id_seq OWNED BY public.suppliers.id;


--
-- Name: system_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_config (
    key character varying(100) NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    notes text
);


--
-- Name: system_health_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_health_checks (
    id bigint NOT NULL,
    check_type text NOT NULL,
    status text NOT NULL,
    response_time_ms integer,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_health_checks_status_check CHECK ((status = ANY (ARRAY['healthy'::text, 'degraded'::text, 'unhealthy'::text])))
);


--
-- Name: system_health_checks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_health_checks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_health_checks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_health_checks_id_seq OWNED BY public.system_health_checks.id;


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id bigint NOT NULL,
    setting_key text NOT NULL,
    setting_value jsonb NOT NULL,
    setting_type text DEFAULT 'string'::text NOT NULL,
    description text,
    is_sensitive boolean DEFAULT false NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_settings_setting_type_check CHECK ((setting_type = ANY (ARRAY['string'::text, 'number'::text, 'boolean'::text, 'json'::text])))
);


--
-- Name: TABLE system_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.system_settings IS 'Cai dat he thong — tham so cau hinh toan cuc';


--
-- Name: system_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_settings_id_seq OWNED BY public.system_settings.id;


--
-- Name: taggings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.taggings (
    id bigint NOT NULL,
    tag_id bigint NOT NULL,
    ref_type text NOT NULL,
    ref_id bigint NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE taggings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.taggings IS 'Lien ket nhan — polymorphic, ap dung cho moi doi tuong';


--
-- Name: taggings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.taggings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: taggings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.taggings_id_seq OWNED BY public.taggings.id;


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id bigint NOT NULL,
    tag_name text NOT NULL,
    color text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE tags; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tags IS 'Nhan dan — he thong tag linh hoat';


--
-- Name: tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tags_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tags_id_seq OWNED BY public.tags.id;


--
-- Name: task_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_assignments (
    id bigint NOT NULL,
    title text NOT NULL,
    description text,
    task_type text NOT NULL,
    priority integer DEFAULT 3 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    assigned_to uuid NOT NULL,
    assigned_by uuid,
    due_date timestamp with time zone,
    completed_at timestamp with time zone,
    ref_type text,
    ref_id bigint,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_assignments_priority_check CHECK (((priority >= 1) AND (priority <= 4))),
    CONSTRAINT task_assignments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text, 'overdue'::text]))),
    CONSTRAINT task_assignments_task_type_check CHECK ((task_type = ANY (ARRAY['rfq_review'::text, 'po_followup'::text, 'delivery_prep'::text, 'invoice_review'::text, 'general'::text])))
);


--
-- Name: task_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_assignments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_assignments_id_seq OWNED BY public.task_assignments.id;


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id bigint NOT NULL,
    title text NOT NULL,
    description text,
    assigned_to uuid NOT NULL,
    assigned_by uuid NOT NULL,
    priority smallint DEFAULT 2 NOT NULL,
    status text DEFAULT 'todo'::text NOT NULL,
    due_date date,
    completed_at timestamp with time zone,
    ref_type text,
    ref_id bigint,
    tags text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tasks_priority_check CHECK (((priority >= 1) AND (priority <= 5))),
    CONSTRAINT tasks_status_check CHECK ((status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'done'::text, 'cancelled'::text])))
);


--
-- Name: TABLE tasks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tasks IS 'Cong viec — quan ly giao viec noi bo';


--
-- Name: tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tasks_id_seq OWNED BY public.tasks.id;


--
-- Name: user_activity_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_activity_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_activity_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_activity_log_id_seq OWNED BY public.user_activity_log.id;


--
-- Name: user_pets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_pets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    species text NOT NULL,
    nickname text,
    current_form integer DEFAULT 1 NOT NULL,
    exp integer DEFAULT 0 NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    is_avatar boolean DEFAULT false NOT NULL,
    last_fed_at timestamp with time zone,
    last_pet_at timestamp with time zone,
    last_play_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_pets_current_form_check CHECK ((current_form = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT user_pets_exp_check CHECK ((exp >= 0)),
    CONSTRAINT user_pets_level_check CHECK ((level >= 1))
);


--
-- Name: TABLE user_pets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_pets IS 'Pet của user — adopt tối đa 3/user, 1 đặt làm avatar';


--
-- Name: COLUMN user_pets.current_form; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_pets.current_form IS '1/2/3 = baby/teen/adult, auto-progresses on level threshold';


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    session_token text NOT NULL,
    ip_address inet,
    user_agent text,
    device_info jsonb,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    is_revoked boolean DEFAULT false NOT NULL,
    revoked_at timestamp with time zone,
    revoked_reason text
);


--
-- Name: TABLE user_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_sessions IS 'Phien dang nhap — ho tro thu hoi (revoke)';


--
-- Name: user_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_sessions_id_seq OWNED BY public.user_sessions.id;


--
-- Name: v_bqms_best_image; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_bqms_best_image AS
 SELECT DISTINCT ON (bii.bqms_code) bii.bqms_code,
    bii.image_path,
    bii.source,
    bii.rfq_number,
    bii.file_size,
    bii.mtime,
    (pc.bqms_code IS NOT NULL) AS is_user_primary
   FROM (public.bqms_image_index bii
     LEFT JOIN public.bqms_code_primary_image pc ON (((pc.bqms_code = bii.bqms_code) AND (pc.image_path = bii.image_path))))
  ORDER BY bii.bqms_code, (pc.bqms_code IS NOT NULL) DESC,
        CASE bii.source
            WHEN 'override'::text THEN 1
            WHEN 'quote'::text THEN 2
            WHEN 'rfq'::text THEN 3
            WHEN 'product'::text THEN 4
            ELSE 5
        END, bii.mtime DESC NULLS LAST, bii.file_size DESC NULLS LAST, bii.id;


--
-- Name: vendor_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_quotes (
    id bigint NOT NULL,
    batch_id bigint NOT NULL,
    vendor_id bigint,
    currency text DEFAULT 'USD'::text NOT NULL,
    total_amount numeric,
    lead_time_days integer,
    moq_notes text,
    notes text,
    attachment_path text,
    status text DEFAULT 'draft'::text NOT NULL,
    submitted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    submitted_via_token_id bigint,
    submitter_name text,
    submitter_email text,
    submitter_phone text,
    submitter_company text,
    can_do boolean DEFAULT true NOT NULL,
    reject_reason text,
    round_number integer DEFAULT 1,
    valid_until timestamp with time zone,
    withdrawn_at timestamp with time zone,
    withdraw_reason text,
    external_url text,
    CONSTRAINT vendor_quotes_currency_check2 CHECK ((currency = ANY (ARRAY['VND'::text, 'JPY'::text, 'USD'::text, 'KRW'::text, 'RMB'::text, 'EUR'::text]))),
    CONSTRAINT vendor_quotes_external_url_scheme CHECK (((external_url IS NULL) OR (external_url ~* '^https?://'::text))),
    CONSTRAINT vendor_quotes_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'awarded'::text, 'rejected'::text, 'withdrawn'::text])))
);


--
-- Name: v_latest_vendor_quote; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_latest_vendor_quote AS
 SELECT DISTINCT ON (batch_id, vendor_id) id AS quote_id,
    batch_id,
    vendor_id,
    round_number,
    currency,
    total_amount,
    lead_time_days,
    status,
    submitted_at
   FROM public.vendor_quotes vq
  WHERE ((vendor_id IS NOT NULL) AND (status = ANY (ARRAY['submitted'::text, 'awarded'::text])))
  ORDER BY batch_id, vendor_id, round_number DESC NULLS LAST, submitted_at DESC NULLS LAST, id DESC;


--
-- Name: v_po_delivery_history; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_po_delivery_history AS
 SELECT unnest(po_numbers) AS po_number,
    id AS dossier_id,
    delivery_attempt_no AS attempt_no,
    sev_type,
    shipping_no,
    invoice_no,
    status,
    form_data,
    is_partial,
    output_folder,
    previous_dossier_id,
    created_at,
    updated_at,
    user_id
   FROM public.bqms_dossier_jobs j
  WHERE (status = ANY (ARRAY['done'::text, 'queued'::text, 'running'::text, 'awaiting_confirm'::text, 'invoice_ready'::text, 'po_downloaded'::text, 'excel_built'::text]));


--
-- Name: xnk_price_lookup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.xnk_price_lookup (
    id bigint NOT NULL,
    rfq_date date,
    quotation_no text,
    bqms_code text,
    item_name text,
    item_explain text,
    item_type text,
    maker text,
    notes text,
    notes2 text,
    unit text,
    quantity numeric,
    quote_deadline text,
    quoted_date date,
    bqms_code3 text,
    hs_code text,
    price_usd numeric,
    price_vnd numeric,
    total_usd numeric,
    buyer_name text,
    seller_name text,
    source text DEFAULT 'excel_import'::text,
    raw_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: v_price_observations; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_price_observations AS
 WITH bqms_dedup AS (
         SELECT DISTINCT ON (bqms_rfq.rfq_number, bqms_rfq.bqms_code) bqms_rfq.id,
            bqms_rfq.rfq_number,
            bqms_rfq.bqms_code,
            bqms_rfq.specification,
            bqms_rfq.supplier_name,
            bqms_rfq.quoted_price_bqms_v1,
            bqms_rfq.quoted_price_bqms_v4,
            bqms_rfq.purchase_price_vnd,
            bqms_rfq.purchase_price_rmb,
            bqms_rfq.expected_qty,
            COALESCE(bqms_rfq.inquiry_date, (bqms_rfq.created_at)::date) AS obs_date
           FROM public.bqms_rfq
          ORDER BY bqms_rfq.rfq_number, bqms_rfq.bqms_code, (((bqms_rfq.result IS NOT NULL))::integer) DESC, bqms_rfq.updated_at DESC NULLS LAST, bqms_rfq.id DESC
        )
 SELECT 'bqms'::text AS src,
    'quote_v1'::text AS price_role,
    bqms_dedup.bqms_code AS product_key,
    bqms_dedup.bqms_code,
    bqms_dedup.specification AS product_name,
    bqms_dedup.supplier_name AS party_name,
    'supplier'::text AS party_role,
    bqms_dedup.obs_date,
    'VND'::text AS currency_goc,
    bqms_dedup.quoted_price_bqms_v1 AS price_goc,
    bqms_dedup.quoted_price_bqms_v1 AS price_vnd,
    bqms_dedup.expected_qty AS qty,
    bqms_dedup.id AS ref_id,
    'bqms_rfq'::text AS ref_table
   FROM bqms_dedup
  WHERE (bqms_dedup.quoted_price_bqms_v1 > (0)::numeric)
UNION ALL
 SELECT 'bqms'::text AS src,
    'cost_ncc'::text AS price_role,
    bqms_dedup.bqms_code AS product_key,
    bqms_dedup.bqms_code,
    bqms_dedup.specification AS product_name,
    bqms_dedup.supplier_name AS party_name,
    'supplier'::text AS party_role,
    bqms_dedup.obs_date,
    'VND'::text AS currency_goc,
    bqms_dedup.purchase_price_vnd AS price_goc,
    bqms_dedup.purchase_price_vnd AS price_vnd,
    bqms_dedup.expected_qty AS qty,
    bqms_dedup.id AS ref_id,
    'bqms_rfq'::text AS ref_table
   FROM bqms_dedup
  WHERE (bqms_dedup.purchase_price_vnd > (0)::numeric)
UNION ALL
 SELECT 'bqms'::text AS src,
    'cost_ncc'::text AS price_role,
    bqms_dedup.bqms_code AS product_key,
    bqms_dedup.bqms_code,
    bqms_dedup.specification AS product_name,
    bqms_dedup.supplier_name AS party_name,
    'supplier'::text AS party_role,
    bqms_dedup.obs_date,
    'RMB'::text AS currency_goc,
    bqms_dedup.purchase_price_rmb AS price_goc,
    public.fn_to_vnd(bqms_dedup.purchase_price_rmb, 'RMB'::text, bqms_dedup.obs_date) AS price_vnd,
    bqms_dedup.expected_qty AS qty,
    bqms_dedup.id AS ref_id,
    'bqms_rfq'::text AS ref_table
   FROM bqms_dedup
  WHERE (bqms_dedup.purchase_price_rmb > (0)::numeric)
UNION ALL
 SELECT 'sourcing'::text AS src,
    'sale_sourcing'::text AS price_role,
    sourcing_entries.bqms_code AS product_key,
    sourcing_entries.bqms_code,
    sourcing_entries.product_name,
    sourcing_entries.customer_name AS party_name,
    'customer'::text AS party_role,
    sourcing_entries.inquiry_date AS obs_date,
    'VND'::text AS currency_goc,
    sourcing_entries.sale_vnd AS price_goc,
    sourcing_entries.sale_vnd AS price_vnd,
    sourcing_entries.quantity AS qty,
    sourcing_entries.id AS ref_id,
    'sourcing_entries'::text AS ref_table
   FROM public.sourcing_entries
  WHERE ((sourcing_entries.deleted_at IS NULL) AND (sourcing_entries.sale_vnd > (0)::numeric) AND (sourcing_entries.bqms_code IS NOT NULL))
UNION ALL
 SELECT 'sourcing'::text AS src,
    'cost_ncc'::text AS price_role,
    sourcing_entries.bqms_code AS product_key,
    sourcing_entries.bqms_code,
    sourcing_entries.product_name,
    sourcing_entries.supplier_name AS party_name,
    'supplier'::text AS party_role,
    sourcing_entries.inquiry_date AS obs_date,
    'VND'::text AS currency_goc,
    sourcing_entries.cost_vnd AS price_goc,
    sourcing_entries.cost_vnd AS price_vnd,
    sourcing_entries.quantity AS qty,
    sourcing_entries.id AS ref_id,
    'sourcing_entries'::text AS ref_table
   FROM public.sourcing_entries
  WHERE ((sourcing_entries.deleted_at IS NULL) AND (sourcing_entries.cost_vnd > (0)::numeric) AND (sourcing_entries.bqms_code IS NOT NULL))
UNION ALL
 SELECT 'xnk'::text AS src,
    'market_xnk'::text AS price_role,
    xnk_price_lookup.bqms_code AS product_key,
    xnk_price_lookup.bqms_code,
    xnk_price_lookup.item_name AS product_name,
    xnk_price_lookup.seller_name AS party_name,
    'competitor'::text AS party_role,
    COALESCE(xnk_price_lookup.rfq_date, xnk_price_lookup.quoted_date) AS obs_date,
    'VND'::text AS currency_goc,
    xnk_price_lookup.price_vnd AS price_goc,
    xnk_price_lookup.price_vnd,
    xnk_price_lookup.quantity AS qty,
    xnk_price_lookup.id AS ref_id,
    'xnk_price_lookup'::text AS ref_table
   FROM public.xnk_price_lookup
  WHERE ((xnk_price_lookup.price_vnd > (0)::numeric) AND (xnk_price_lookup.bqms_code IS NOT NULL))
UNION ALL
 SELECT 'imv'::text AS src,
    'imv_buy'::text AS price_role,
    o.item_code AS product_key,
    p.bqms_code,
    o.product_name,
    o.customer_name AS party_name,
    'customer'::text AS party_role,
    o.order_date AS obs_date,
    o.currency AS currency_goc,
    o.unit_price AS price_goc,
        CASE
            WHEN (upper((COALESCE(o.currency, 'VND'::character varying))::text) = 'VND'::text) THEN o.unit_price
            ELSE public.fn_to_vnd(o.unit_price, (o.currency)::text, o.order_date)
        END AS price_vnd,
    o.quantity AS qty,
    o.id AS ref_id,
    'imv_orders'::text AS ref_table
   FROM (public.imv_orders o
     LEFT JOIN public.products p ON ((p.imv_code = (o.item_code)::text)))
  WHERE (o.unit_price > (0)::numeric);


--
-- Name: v_price_observations_clean; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_price_observations_clean AS
 WITH cfg AS (
         SELECT max(price_intel_config.value) FILTER (WHERE (price_intel_config.key = 'mad_k'::text)) AS mad_k,
            max(price_intel_config.value) FILTER (WHERE (price_intel_config.key = 'recency_months'::text)) AS recency_months,
            max(price_intel_config.value) FILTER (WHERE (price_intel_config.key = 'enable_L4_outlier'::text)) AS en_l4,
            max(price_intel_config.value) FILTER (WHERE (price_intel_config.key = 'enable_L5_recency'::text)) AS en_l5
           FROM public.price_intel_config
        ), base AS (
         SELECT o.src,
            o.price_role,
            o.product_key,
            o.bqms_code,
            o.product_name,
            o.party_name,
            o.party_role,
            o.obs_date,
            o.currency_goc,
            o.price_goc,
            o.price_vnd,
            o.qty,
            o.ref_id,
            o.ref_table,
            upper(btrim(o.product_key)) AS product_key_canon,
            NULLIF(btrim(o.party_name), ''::text) AS party_name_canon,
            o.price_vnd AS px
           FROM public.v_price_observations o
          WHERE ((o.price_goc > (0)::numeric) AND (o.price_vnd IS NOT NULL) AND (o.price_vnd > (0)::numeric))
        ), med AS (
         SELECT base.product_key_canon,
            percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((base.px)::double precision)) AS med_px,
            count(*) AS n_code
           FROM base
          GROUP BY base.product_key_canon
        ), dev AS (
         SELECT b.src,
            b.price_role,
            b.product_key,
            b.bqms_code,
            b.product_name,
            b.party_name,
            b.party_role,
            b.obs_date,
            b.currency_goc,
            b.price_goc,
            b.price_vnd,
            b.qty,
            b.ref_id,
            b.ref_table,
            b.product_key_canon,
            b.party_name_canon,
            b.px,
            m.med_px,
            m.n_code,
            abs(((b.px)::double precision - m.med_px)) AS absdev
           FROM (base b
             JOIN med m USING (product_key_canon))
        ), mad AS (
         SELECT dev.product_key_canon,
            percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY dev.absdev) AS mad_px
           FROM dev
          GROUP BY dev.product_key_canon
        ), scored AS (
         SELECT d.src,
            d.price_role,
            d.product_key,
            d.bqms_code,
            d.product_name,
            d.party_name,
            d.party_role,
            d.obs_date,
            d.currency_goc,
            d.price_goc,
            d.price_vnd,
            d.qty,
            d.ref_id,
            d.ref_table,
            d.product_key_canon,
            d.party_name_canon,
            d.px,
            d.med_px,
            d.n_code,
            d.absdev,
            mad.mad_px,
                CASE
                    WHEN (mad.mad_px > (0)::double precision) THEN (((0.6745)::double precision * d.absdev) / mad.mad_px)
                    ELSE (0)::double precision
                END AS robust_z
           FROM (dev d
             JOIN mad USING (product_key_canon))
        ), labelled AS (
         SELECT s.src,
            s.price_role,
            s.product_key,
            s.bqms_code,
            s.product_name,
            s.party_name,
            s.party_role,
            s.obs_date,
            s.currency_goc,
            s.price_goc,
            s.price_vnd,
            s.qty,
            s.ref_id,
            s.ref_table,
            s.product_key_canon,
            s.party_name_canon,
            s.px,
            s.med_px,
            s.n_code,
            s.absdev,
            s.mad_px,
            s.robust_z,
                CASE
                    WHEN ((( SELECT cfg.en_l5
                       FROM cfg) = (1)::numeric) AND (s.obs_date < (CURRENT_DATE - (((( SELECT cfg.recency_months
                       FROM cfg))::text || ' months'::text))::interval))) THEN 'stale'::text
                    WHEN ((( SELECT cfg.en_l4
                       FROM cfg) = (1)::numeric) AND (s.mad_px > (0)::double precision) AND (s.robust_z > (( SELECT cfg.mad_k
                       FROM cfg))::double precision)) THEN 'outlier_mad'::text
                    ELSE NULL::text
                END AS dropped_reason
           FROM scored s
        )
 SELECT src,
    price_role,
    product_key,
    bqms_code,
    product_name,
    party_name,
    party_role,
    obs_date,
    currency_goc,
    price_goc,
    price_vnd,
    qty,
    ref_id,
    ref_table,
    product_key_canon,
    n_code,
    robust_z,
    GREATEST(0, (100 -
        CASE
            WHEN (robust_z > (3)::double precision) THEN LEAST(20, ((robust_z * (3)::double precision))::integer)
            ELSE 0
        END)) AS quality_score
   FROM labelled
  WHERE (dropped_reason IS NULL);


--
-- Name: v_unified_orders; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_unified_orders AS
 SELECT so.id AS order_id,
    so.order_number AS order_ref,
    so.chain_code,
    so.source_type,
    so.samsung_po_number,
    COALESCE(NULLIF(so.customer_name, ''::text), c.company_name, '—'::text) AS customer_name,
    so.customer_id,
    so.status AS order_status,
    so.order_date,
    so.delivery_date,
    so.payment_terms,
    so.currency,
    COALESCE(so.total_value_vnd, (0)::numeric) AS revenue_vnd,
    so.assigned_to,
    so.created_by_email,
    so.updated_at AS order_updated_at,
    rc.current_stage AS chain_stage,
    rc.is_complete AS chain_complete,
    COALESCE(rc.revenue_vnd, so.total_value_vnd, (0)::numeric) AS chain_revenue_vnd,
    rc.margin_pct AS chain_margin_pct,
    po.id AS po_id,
    po.po_number,
    (po.status)::text AS po_status,
    bd.delivery_count,
    bd.delivered_count,
    bd.last_delivery_status,
    bd.last_delivery_date,
    ar.id AS ar_id,
    (ar.status)::text AS ar_status,
    COALESCE(ar.amount, (0)::numeric) AS ar_amount,
    COALESCE(ar.paid_amount, (0)::numeric) AS ar_paid_amount,
    (COALESCE(ar.amount, (0)::numeric) - COALESCE(ar.paid_amount, (0)::numeric)) AS ar_outstanding,
    ar.due_date AS ar_due_date,
        CASE
            WHEN (ar.id IS NULL) THEN 'none'::text
            WHEN ((ar.status)::text = 'paid'::text) THEN 'paid'::text
            WHEN ((ar.due_date IS NOT NULL) AND (ar.due_date < CURRENT_DATE) AND ((ar.status)::text <> 'paid'::text)) THEN 'overdue'::text
            ELSE 'open'::text
        END AS ar_state
   FROM (((((public.sourcing_orders so
     LEFT JOIN public.customers c ON ((c.id = so.customer_id)))
     LEFT JOIN public.revenue_chain rc ON (((rc.chain_code = so.chain_code) AND (so.chain_code IS NOT NULL))))
     LEFT JOIN public.accounts_receivable ar ON ((ar.sourcing_order_id = so.id)))
     LEFT JOIN LATERAL ( SELECT p.id,
            p.po_number,
            p.status
           FROM public.purchase_orders p
          WHERE (p.sourcing_order_id = so.id)
          ORDER BY p.created_at DESC, p.id DESC
         LIMIT 1) po ON (true))
     LEFT JOIN LATERAL ( SELECT count(*) AS delivery_count,
            count(*) FILTER (WHERE (d.delivery_status = 'da_giao'::public.delivery_status)) AS delivered_count,
            (array_agg((d.delivery_status)::text ORDER BY d.updated_at DESC))[1] AS last_delivery_status,
            max(d.delivery_date) AS last_delivery_date
           FROM public.bqms_deliveries d
          WHERE (d.sourcing_order_id = so.id)) bd ON (true))
  WHERE (so.deleted_at IS NULL);


--
-- Name: VIEW v_unified_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_unified_orders IS 'Phase 3 — unified order spine: sourcing_orders ⨝ revenue_chain ⨝ purchase_orders ⨝ bqms_deliveries ⨝ accounts_receivable (read-only).';


--
-- Name: vendor_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_accounts (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    supplier_id bigint,
    company_name text NOT NULL,
    contact_name text NOT NULL,
    phone text,
    address text,
    tax_code text,
    product_categories text[],
    is_approved boolean DEFAULT false,
    approved_by uuid,
    approved_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status public.vendor_account_status DEFAULT 'pending'::public.vendor_account_status NOT NULL,
    invited_by uuid,
    activation_token text,
    activation_expires timestamp with time zone,
    last_login_at timestamp with time zone,
    rejected_reason text,
    reset_token text,
    reset_expires timestamp with time zone
);


--
-- Name: vendor_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_accounts_id_seq OWNED BY public.vendor_accounts.id;


--
-- Name: vendor_quote_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_quote_items (
    id bigint NOT NULL,
    quote_id bigint NOT NULL,
    item_id bigint NOT NULL,
    unit_price numeric NOT NULL,
    quantity numeric,
    lead_time_days integer,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    can_do boolean DEFAULT true NOT NULL,
    attachment_paths jsonb DEFAULT '[]'::jsonb NOT NULL,
    offered_qty numeric,
    moq text,
    currency text,
    free_charge boolean DEFAULT false NOT NULL,
    CONSTRAINT vendor_quote_items_currency_chk CHECK (((currency IS NULL) OR (currency = ANY (ARRAY['VND'::text, 'JPY'::text, 'USD'::text, 'KRW'::text, 'RMB'::text, 'EUR'::text]))))
);


--
-- Name: vendor_quote_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_quote_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_quote_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_quote_items_id_seq OWNED BY public.vendor_quote_items.id;


--
-- Name: vendor_quotes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_quotes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_quotes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_quotes_id_seq OWNED BY public.vendor_quotes.id;


--
-- Name: workflow_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_history (
    id bigint NOT NULL,
    instance_id bigint NOT NULL,
    from_status public.workflow_status,
    to_status public.workflow_status NOT NULL,
    action text NOT NULL,
    actor_id uuid NOT NULL,
    comment text,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE workflow_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.workflow_history IS 'Lich su quy trinh duyet — bat bien, khong sua/xoa';


--
-- Name: workflow_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflow_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflow_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_history_id_seq OWNED BY public.workflow_history.id;


--
-- Name: workflow_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_instances (
    id bigint NOT NULL,
    workflow_type public.workflow_type NOT NULL,
    current_status public.workflow_status DEFAULT 'draft'::public.workflow_status NOT NULL,
    title text NOT NULL,
    description text,
    amount numeric(15,2),
    currency public.currency_code DEFAULT 'VND'::public.currency_code,
    priority smallint DEFAULT 2 NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    ref_type text,
    ref_id bigint,
    created_by uuid NOT NULL,
    assigned_to uuid,
    deadline timestamp with time zone,
    started_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workflow_instances_priority_check CHECK (((priority >= 1) AND (priority <= 5)))
);


--
-- Name: TABLE workflow_instances; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.workflow_instances IS 'Quy trinh duyet — moi yeu cau duyet la 1 ban ghi';


--
-- Name: workflow_instances_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflow_instances_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflow_instances_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_instances_id_seq OWNED BY public.workflow_instances.id;


--
-- Name: xnk_price_lookup_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.xnk_price_lookup_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: xnk_price_lookup_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.xnk_price_lookup_id_seq OWNED BY public.xnk_price_lookup.id;


--
-- Name: accounts_payable id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_payable ALTER COLUMN id SET DEFAULT nextval('public.accounts_payable_id_seq'::regclass);


--
-- Name: accounts_receivable id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_receivable ALTER COLUMN id SET DEFAULT nextval('public.accounts_receivable_id_seq'::regclass);


--
-- Name: ai_classification_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_classification_results ALTER COLUMN id SET DEFAULT nextval('public.ai_classification_results_id_seq'::regclass);


--
-- Name: attendance_incidents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_incidents ALTER COLUMN id SET DEFAULT nextval('public.attendance_incidents_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: backup_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_log ALTER COLUMN id SET DEFAULT nextval('public.backup_log_id_seq'::regclass);


--
-- Name: bqms_contacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_contacts ALTER COLUMN id SET DEFAULT nextval('public.bqms_contacts_id_seq'::regclass);


--
-- Name: bqms_contract_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_contract_items ALTER COLUMN id SET DEFAULT nextval('public.bqms_contract_items_id_seq'::regclass);


--
-- Name: bqms_contracts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_contracts ALTER COLUMN id SET DEFAULT nextval('public.bqms_contracts_id_seq'::regclass);


--
-- Name: bqms_deliveries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_deliveries ALTER COLUMN id SET DEFAULT nextval('public.bqms_deliveries_id_seq'::regclass);


--
-- Name: bqms_dossier_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_dossier_jobs ALTER COLUMN id SET DEFAULT nextval('public.bqms_dossier_jobs_id_seq'::regclass);


--
-- Name: bqms_image_index id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_image_index ALTER COLUMN id SET DEFAULT nextval('public.bqms_image_index_id_seq'::regclass);


--
-- Name: bqms_manufacturing_daily id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_manufacturing_daily ALTER COLUMN id SET DEFAULT nextval('public.bqms_manufacturing_daily_id_seq'::regclass);


--
-- Name: bqms_manufacturing_schedule id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_manufacturing_schedule ALTER COLUMN id SET DEFAULT nextval('public.bqms_manufacturing_schedule_id_seq'::regclass);


--
-- Name: bqms_material_pricing id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_material_pricing ALTER COLUMN id SET DEFAULT nextval('public.bqms_material_pricing_id_seq'::regclass);


--
-- Name: bqms_monthly_po_summary id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_monthly_po_summary ALTER COLUMN id SET DEFAULT nextval('public.bqms_monthly_po_summary_id_seq'::regclass);


--
-- Name: bqms_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_orders ALTER COLUMN id SET DEFAULT nextval('public.bqms_orders_id_seq'::regclass);


--
-- Name: bqms_qt_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_qt_events ALTER COLUMN id SET DEFAULT nextval('public.bqms_qt_events_id_seq'::regclass);


--
-- Name: bqms_quotation_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_quotation_items ALTER COLUMN id SET DEFAULT nextval('public.bqms_quotation_items_id_seq'::regclass);


--
-- Name: bqms_quote_batch_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_quote_batch_items ALTER COLUMN id SET DEFAULT nextval('public.bqms_quote_batch_items_id_seq'::regclass);


--
-- Name: bqms_quote_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_quote_batches ALTER COLUMN id SET DEFAULT nextval('public.bqms_quote_batches_id_seq'::regclass);


--
-- Name: bqms_quote_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_quote_log ALTER COLUMN id SET DEFAULT nextval('public.bqms_quote_log_id_seq'::regclass);


--
-- Name: bqms_raw_material_po id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_raw_material_po ALTER COLUMN id SET DEFAULT nextval('public.bqms_raw_material_po_id_seq'::regclass);


--
-- Name: bqms_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_records ALTER COLUMN id SET DEFAULT nextval('public.bqms_records_id_seq'::regclass);


--
-- Name: bqms_rfq id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_rfq ALTER COLUMN id SET DEFAULT nextval('public.bqms_rfq_id_seq'::regclass);


--
-- Name: bqms_rfq_submissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_rfq_submissions ALTER COLUMN id SET DEFAULT nextval('public.bqms_rfq_submissions_id_seq'::regclass);


--
-- Name: bqms_row_gaps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_row_gaps ALTER COLUMN id SET DEFAULT nextval('public.bqms_row_gaps_id_seq'::regclass);


--
-- Name: bqms_samsung_po id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_samsung_po ALTER COLUMN id SET DEFAULT nextval('public.bqms_samsung_po_id_seq'::regclass);


--
-- Name: bqms_scrape_presence id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_scrape_presence ALTER COLUMN id SET DEFAULT nextval('public.bqms_scrape_presence_id_seq'::regclass);


--
-- Name: bqms_vendor_portal_staging id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_vendor_portal_staging ALTER COLUMN id SET DEFAULT nextval('public.bqms_vendor_portal_staging_id_seq'::regclass);


--
-- Name: bqms_won_quotations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_won_quotations ALTER COLUMN id SET DEFAULT nextval('public.bqms_won_quotations_id_seq'::regclass);


--
-- Name: budget_targets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_targets ALTER COLUMN id SET DEFAULT nextval('public.budget_targets_id_seq'::regclass);


--
-- Name: calendar_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events ALTER COLUMN id SET DEFAULT nextval('public.calendar_events_id_seq'::regclass);


--
-- Name: cash_book id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_book ALTER COLUMN id SET DEFAULT nextval('public.cash_book_id_seq'::regclass);


--
-- Name: cash_book_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_book_categories ALTER COLUMN id SET DEFAULT nextval('public.cash_book_categories_id_seq'::regclass);


--
-- Name: companies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies ALTER COLUMN id SET DEFAULT nextval('public.companies_id_seq'::regclass);


--
-- Name: contract_price_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_price_items ALTER COLUMN id SET DEFAULT nextval('public.contract_price_items_id_seq'::regclass);


--
-- Name: crm_account_external_map id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_account_external_map ALTER COLUMN id SET DEFAULT nextval('public.crm_account_external_map_id_seq'::regclass);


--
-- Name: crm_contacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts ALTER COLUMN id SET DEFAULT nextval('public.crm_contacts_id_seq'::regclass);


--
-- Name: crm_interactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_interactions ALTER COLUMN id SET DEFAULT nextval('public.crm_interactions_id_seq'::regclass);


--
-- Name: crm_pipeline_cards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_pipeline_cards ALTER COLUMN id SET DEFAULT nextval('public.crm_pipeline_cards_id_seq'::regclass);


--
-- Name: customer_contacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_contacts ALTER COLUMN id SET DEFAULT nextval('public.customer_contacts_id_seq'::regclass);


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: customs_declaration_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_declaration_items ALTER COLUMN id SET DEFAULT nextval('public.customs_declaration_items_id_seq'::regclass);


--
-- Name: customs_declarations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_declarations ALTER COLUMN id SET DEFAULT nextval('public.customs_declarations_id_seq'::regclass);


--
-- Name: data_quality_checks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_quality_checks ALTER COLUMN id SET DEFAULT nextval('public.data_quality_checks_id_seq'::regclass);


--
-- Name: deal_margins id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_margins ALTER COLUMN id SET DEFAULT nextval('public.deal_margins_id_seq'::regclass);


--
-- Name: delivery_receipts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_receipts ALTER COLUMN id SET DEFAULT nextval('public.delivery_receipts_id_seq'::regclass);


--
-- Name: demand_forecasts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demand_forecasts ALTER COLUMN id SET DEFAULT nextval('public.demand_forecasts_id_seq'::regclass);


--
-- Name: documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents ALTER COLUMN id SET DEFAULT nextval('public.documents_id_seq'::regclass);


--
-- Name: domain_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domain_events ALTER COLUMN id SET DEFAULT nextval('public.domain_events_id_seq'::regclass);


--
-- Name: e_invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.e_invoices ALTER COLUMN id SET DEFAULT nextval('public.e_invoices_id_seq'::regclass);


--
-- Name: email_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_history ALTER COLUMN id SET DEFAULT nextval('public.email_history_id_seq'::regclass);


--
-- Name: employee_monthly_kpi id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_monthly_kpi ALTER COLUMN id SET DEFAULT nextval('public.employee_monthly_kpi_id_seq'::regclass);


--
-- Name: error_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_log ALTER COLUMN id SET DEFAULT nextval('public.error_log_id_seq'::regclass);


--
-- Name: etl_sync_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etl_sync_log ALTER COLUMN id SET DEFAULT nextval('public.etl_sync_log_id_seq'::regclass);


--
-- Name: exchange_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rates ALTER COLUMN id SET DEFAULT nextval('public.exchange_rates_id_seq'::regclass);


--
-- Name: file_meta id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_meta ALTER COLUMN id SET DEFAULT nextval('public.file_meta_id_seq'::regclass);


--
-- Name: file_review_status id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_review_status ALTER COLUMN id SET DEFAULT nextval('public.file_review_status_id_seq'::regclass);


--
-- Name: fiscal_periods id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_periods ALTER COLUMN id SET DEFAULT nextval('public.fiscal_periods_id_seq'::regclass);


--
-- Name: help_articles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.help_articles ALTER COLUMN id SET DEFAULT nextval('public.help_articles_id_seq'::regclass);


--
-- Name: hs_codes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hs_codes ALTER COLUMN id SET DEFAULT nextval('public.hs_codes_id_seq'::regclass);


--
-- Name: import_export_tracking id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_export_tracking ALTER COLUMN id SET DEFAULT nextval('public.import_export_tracking_id_seq'::regclass);


--
-- Name: imv_consolidated id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_consolidated ALTER COLUMN id SET DEFAULT nextval('public.imv_consolidated_id_seq'::regclass);


--
-- Name: imv_contracts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_contracts ALTER COLUMN id SET DEFAULT nextval('public.imv_contracts_id_seq'::regclass);


--
-- Name: imv_deliveries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_deliveries ALTER COLUMN id SET DEFAULT nextval('public.imv_deliveries_id_seq'::regclass);


--
-- Name: imv_inquiries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_inquiries ALTER COLUMN id SET DEFAULT nextval('public.imv_inquiries_id_seq'::regclass);


--
-- Name: imv_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_orders ALTER COLUMN id SET DEFAULT nextval('public.imv_orders_id_seq'::regclass);


--
-- Name: imv_payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_payments ALTER COLUMN id SET DEFAULT nextval('public.imv_payments_id_seq'::regclass);


--
-- Name: imv_purchase_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_purchase_orders ALTER COLUMN id SET DEFAULT nextval('public.imv_purchase_orders_id_seq'::regclass);


--
-- Name: imv_rejections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_rejections ALTER COLUMN id SET DEFAULT nextval('public.imv_rejections_id_seq'::regclass);


--
-- Name: imv_rfq id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_rfq ALTER COLUMN id SET DEFAULT nextval('public.imv_rfq_id_seq'::regclass);


--
-- Name: imv_sync_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_sync_log ALTER COLUMN id SET DEFAULT nextval('public.imv_sync_log_id_seq'::regclass);


--
-- Name: inventory id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory ALTER COLUMN id SET DEFAULT nextval('public.inventory_id_seq'::regclass);


--
-- Name: inventory_movements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements ALTER COLUMN id SET DEFAULT nextval('public.inventory_movements_id_seq'::regclass);


--
-- Name: invoice_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items ALTER COLUMN id SET DEFAULT nextval('public.invoice_items_id_seq'::regclass);


--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);


--
-- Name: leave_balance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_balance ALTER COLUMN id SET DEFAULT nextval('public.leave_balance_id_seq'::regclass);


--
-- Name: leave_policy id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_policy ALTER COLUMN id SET DEFAULT nextval('public.leave_policy_id_seq'::regclass);


--
-- Name: leave_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests ALTER COLUMN id SET DEFAULT nextval('public.leave_requests_id_seq'::regclass);


--
-- Name: market_prices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_prices ALTER COLUMN id SET DEFAULT nextval('public.market_prices_id_seq'::regclass);


--
-- Name: material_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_types ALTER COLUMN id SET DEFAULT nextval('public.material_types_id_seq'::regclass);


--
-- Name: mv_refresh_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mv_refresh_log ALTER COLUMN id SET DEFAULT nextval('public.mv_refresh_log_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: ocr_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_results ALTER COLUMN id SET DEFAULT nextval('public.ocr_results_id_seq'::regclass);


--
-- Name: onedrive_file_index id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onedrive_file_index ALTER COLUMN id SET DEFAULT nextval('public.onedrive_file_index_id_seq'::regclass);


--
-- Name: payment_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests ALTER COLUMN id SET DEFAULT nextval('public.payment_requests_id_seq'::regclass);


--
-- Name: payment_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions ALTER COLUMN id SET DEFAULT nextval('public.payment_transactions_id_seq'::regclass);


--
-- Name: pet_exp_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pet_exp_log ALTER COLUMN id SET DEFAULT nextval('public.pet_exp_log_id_seq'::regclass);


--
-- Name: pim_enrichment_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pim_enrichment_audit ALTER COLUMN id SET DEFAULT nextval('public.pim_enrichment_audit_id_seq'::regclass);


--
-- Name: po_line_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_line_items ALTER COLUMN id SET DEFAULT nextval('public.po_line_items_id_seq'::regclass);


--
-- Name: price_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history ALTER COLUMN id SET DEFAULT nextval('public.price_history_id_seq'::regclass);


--
-- Name: procrastinate_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procrastinate_events ALTER COLUMN id SET DEFAULT nextval('public.procrastinate_events_id_seq'::regclass);


--
-- Name: procrastinate_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procrastinate_jobs ALTER COLUMN id SET DEFAULT nextval('public.procrastinate_jobs_id_seq'::regclass);


--
-- Name: procrastinate_periodic_defers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procrastinate_periodic_defers ALTER COLUMN id SET DEFAULT nextval('public.procrastinate_periodic_defers_id_seq'::regclass);


--
-- Name: procurement_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_audit_log ALTER COLUMN id SET DEFAULT nextval('public.procurement_audit_log_id_seq'::regclass);


--
-- Name: procurement_awards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_awards ALTER COLUMN id SET DEFAULT nextval('public.procurement_awards_id_seq'::regclass);


--
-- Name: procurement_bid_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_bid_tokens ALTER COLUMN id SET DEFAULT nextval('public.procurement_bid_tokens_id_seq'::regclass);


--
-- Name: procurement_contract_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_contract_items ALTER COLUMN id SET DEFAULT nextval('public.procurement_contract_items_id_seq'::regclass);


--
-- Name: procurement_contracts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_contracts ALTER COLUMN id SET DEFAULT nextval('public.procurement_contracts_id_seq'::regclass);


--
-- Name: procurement_deliveries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_deliveries ALTER COLUMN id SET DEFAULT nextval('public.procurement_deliveries_id_seq'::regclass);


--
-- Name: procurement_delivery_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_delivery_items ALTER COLUMN id SET DEFAULT nextval('public.procurement_delivery_items_id_seq'::regclass);


--
-- Name: procurement_po_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_po_items ALTER COLUMN id SET DEFAULT nextval('public.procurement_po_items_id_seq'::regclass);


--
-- Name: procurement_pos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_pos ALTER COLUMN id SET DEFAULT nextval('public.procurement_pos_id_seq'::regclass);


--
-- Name: procurement_rfq_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_batches ALTER COLUMN id SET DEFAULT nextval('public.procurement_rfq_batches_id_seq'::regclass);


--
-- Name: procurement_rfq_invitations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_invitations ALTER COLUMN id SET DEFAULT nextval('public.procurement_rfq_invitations_id_seq'::regclass);


--
-- Name: procurement_rfq_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_items ALTER COLUMN id SET DEFAULT nextval('public.procurement_rfq_items_id_seq'::regclass);


--
-- Name: procurement_rfq_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_messages ALTER COLUMN id SET DEFAULT nextval('public.procurement_rfq_messages_id_seq'::regclass);


--
-- Name: procurement_rfq_shared_files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_shared_files ALTER COLUMN id SET DEFAULT nextval('public.procurement_rfq_shared_files_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Name: profit_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_reports ALTER COLUMN id SET DEFAULT nextval('public.profit_reports_id_seq'::regclass);


--
-- Name: public_holidays id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_holidays ALTER COLUMN id SET DEFAULT nextval('public.public_holidays_id_seq'::regclass);


--
-- Name: purchase_invoices_q id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_invoices_q ALTER COLUMN id SET DEFAULT nextval('public.purchase_invoices_q_id_seq'::regclass);


--
-- Name: purchase_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders ALTER COLUMN id SET DEFAULT nextval('public.purchase_orders_id_seq'::regclass);


--
-- Name: quotation_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_templates ALTER COLUMN id SET DEFAULT nextval('public.quotation_templates_id_seq'::regclass);


--
-- Name: quotations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations ALTER COLUMN id SET DEFAULT nextval('public.quotations_id_seq'::regclass);


--
-- Name: quote_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_batches ALTER COLUMN id SET DEFAULT nextval('public.quote_batches_id_seq'::regclass);


--
-- Name: report_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_executions ALTER COLUMN id SET DEFAULT nextval('public.report_executions_id_seq'::regclass);


--
-- Name: retry_queue id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retry_queue ALTER COLUMN id SET DEFAULT nextval('public.retry_queue_id_seq'::regclass);


--
-- Name: revenue_chain id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_chain ALTER COLUMN id SET DEFAULT nextval('public.revenue_chain_id_seq'::regclass);


--
-- Name: revenue_invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_invoices ALTER COLUMN id SET DEFAULT nextval('public.revenue_invoices_id_seq'::regclass);


--
-- Name: rfq_line_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_line_items ALTER COLUMN id SET DEFAULT nextval('public.rfq_line_items_id_seq'::regclass);


--
-- Name: rfq_quotations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_quotations ALTER COLUMN id SET DEFAULT nextval('public.rfq_quotations_id_seq'::regclass);


--
-- Name: rfq_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_requests ALTER COLUMN id SET DEFAULT nextval('public.rfq_requests_id_seq'::regclass);


--
-- Name: sales_invoices_q id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoices_q ALTER COLUMN id SET DEFAULT nextval('public.sales_invoices_q_id_seq'::regclass);


--
-- Name: sales_order_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_items ALTER COLUMN id SET DEFAULT nextval('public.sales_order_items_id_seq'::regclass);


--
-- Name: sales_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders ALTER COLUMN id SET DEFAULT nextval('public.sales_orders_id_seq'::regclass);


--
-- Name: samsung_watchdog_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.samsung_watchdog_events ALTER COLUMN id SET DEFAULT nextval('public.samsung_watchdog_events_id_seq'::regclass);


--
-- Name: scheduled_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_reports ALTER COLUMN id SET DEFAULT nextval('public.scheduled_reports_id_seq'::regclass);


--
-- Name: security_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_log ALTER COLUMN id SET DEFAULT nextval('public.security_log_id_seq'::regclass);


--
-- Name: shipment_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_items ALTER COLUMN id SET DEFAULT nextval('public.shipment_items_id_seq'::regclass);


--
-- Name: shipments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments ALTER COLUMN id SET DEFAULT nextval('public.shipments_id_seq'::regclass);


--
-- Name: sourcing_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_entries ALTER COLUMN id SET DEFAULT nextval('public.sourcing_entries_id_seq'::regclass);


--
-- Name: sourcing_order_status_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_order_status_history ALTER COLUMN id SET DEFAULT nextval('public.sourcing_order_status_history_id_seq'::regclass);


--
-- Name: sourcing_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_orders ALTER COLUMN id SET DEFAULT nextval('public.sourcing_orders_id_seq'::regclass);


--
-- Name: sourcing_pricing_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_pricing_rules ALTER COLUMN id SET DEFAULT nextval('public.sourcing_pricing_rules_id_seq'::regclass);


--
-- Name: sourcing_pricing_rules_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_pricing_rules_history ALTER COLUMN id SET DEFAULT nextval('public.sourcing_pricing_rules_history_id_seq'::regclass);


--
-- Name: sourcing_pricing_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_pricing_snapshots ALTER COLUMN id SET DEFAULT nextval('public.sourcing_pricing_snapshots_id_seq'::regclass);


--
-- Name: sourcing_supplier_prices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_supplier_prices ALTER COLUMN id SET DEFAULT nextval('public.sourcing_supplier_prices_id_seq'::regclass);


--
-- Name: sourcing_vn_shipping_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_vn_shipping_history ALTER COLUMN id SET DEFAULT nextval('public.sourcing_vn_shipping_history_id_seq'::regclass);


--
-- Name: stock_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_alerts ALTER COLUMN id SET DEFAULT nextval('public.stock_alerts_id_seq'::regclass);


--
-- Name: supplier_contracts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_contracts ALTER COLUMN id SET DEFAULT nextval('public.supplier_contracts_id_seq'::regclass);


--
-- Name: supplier_product_map id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_product_map ALTER COLUMN id SET DEFAULT nextval('public.supplier_product_map_id_seq'::regclass);


--
-- Name: supplier_quote_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_quote_items ALTER COLUMN id SET DEFAULT nextval('public.supplier_quote_items_id_seq'::regclass);


--
-- Name: supplier_quotes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_quotes ALTER COLUMN id SET DEFAULT nextval('public.supplier_quotes_id_seq'::regclass);


--
-- Name: supplier_ratings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_ratings ALTER COLUMN id SET DEFAULT nextval('public.supplier_ratings_id_seq'::regclass);


--
-- Name: supplier_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_scores ALTER COLUMN id SET DEFAULT nextval('public.supplier_scores_id_seq'::regclass);


--
-- Name: suppliers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers ALTER COLUMN id SET DEFAULT nextval('public.suppliers_id_seq'::regclass);


--
-- Name: system_health_checks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_health_checks ALTER COLUMN id SET DEFAULT nextval('public.system_health_checks_id_seq'::regclass);


--
-- Name: system_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings ALTER COLUMN id SET DEFAULT nextval('public.system_settings_id_seq'::regclass);


--
-- Name: taggings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taggings ALTER COLUMN id SET DEFAULT nextval('public.taggings_id_seq'::regclass);


--
-- Name: tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags ALTER COLUMN id SET DEFAULT nextval('public.tags_id_seq'::regclass);


--
-- Name: task_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignments ALTER COLUMN id SET DEFAULT nextval('public.task_assignments_id_seq'::regclass);


--
-- Name: tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks ALTER COLUMN id SET DEFAULT nextval('public.tasks_id_seq'::regclass);


--
-- Name: user_activity_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity_log ALTER COLUMN id SET DEFAULT nextval('public.user_activity_log_id_seq'::regclass);


--
-- Name: user_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions ALTER COLUMN id SET DEFAULT nextval('public.user_sessions_id_seq'::regclass);


--
-- Name: vendor_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_accounts ALTER COLUMN id SET DEFAULT nextval('public.vendor_accounts_id_seq'::regclass);


--
-- Name: vendor_quote_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_quote_items ALTER COLUMN id SET DEFAULT nextval('public.vendor_quote_items_id_seq'::regclass);


--
-- Name: vendor_quotes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_quotes ALTER COLUMN id SET DEFAULT nextval('public.vendor_quotes_id_seq'::regclass);


--
-- Name: workflow_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_history ALTER COLUMN id SET DEFAULT nextval('public.workflow_history_id_seq'::regclass);


--
-- Name: workflow_instances id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instances ALTER COLUMN id SET DEFAULT nextval('public.workflow_instances_id_seq'::regclass);


--
-- Name: xnk_price_lookup id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xnk_price_lookup ALTER COLUMN id SET DEFAULT nextval('public.xnk_price_lookup_id_seq'::regclass);


--
-- Name: accounts_payable accounts_payable_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_payable
    ADD CONSTRAINT accounts_payable_pkey PRIMARY KEY (id);


--
-- Name: accounts_receivable accounts_receivable_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_receivable
    ADD CONSTRAINT accounts_receivable_pkey PRIMARY KEY (id);


--
-- Name: ai_classification_results ai_classification_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_classification_results
    ADD CONSTRAINT ai_classification_results_pkey PRIMARY KEY (id);


--
-- Name: app_config app_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_config
    ADD CONSTRAINT app_config_pkey PRIMARY KEY (key);


--
-- Name: attendance_incidents attendance_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_incidents
    ADD CONSTRAINT attendance_incidents_pkey PRIMARY KEY (id);


--
-- Name: attendance_incidents attendance_incidents_user_id_incident_date_incident_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_incidents
    ADD CONSTRAINT attendance_incidents_user_id_incident_date_incident_type_key UNIQUE (user_id, incident_date, incident_type);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: backup_log backup_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_log
    ADD CONSTRAINT backup_log_pkey PRIMARY KEY (id);


--
-- Name: bqms_code_primary_image bqms_code_primary_image_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_code_primary_image
    ADD CONSTRAINT bqms_code_primary_image_pkey PRIMARY KEY (bqms_code);


--
-- Name: bqms_contacts bqms_contacts_email_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_contacts
    ADD CONSTRAINT bqms_contacts_email_username_key UNIQUE (email_username);


--
-- Name: bqms_contacts bqms_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_contacts
    ADD CONSTRAINT bqms_contacts_pkey PRIMARY KEY (id);


--
-- Name: bqms_contract_items bqms_contract_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_contract_items
    ADD CONSTRAINT bqms_contract_items_pkey PRIMARY KEY (id);


--
-- Name: bqms_contracts bqms_contracts_contract_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_contracts
    ADD CONSTRAINT bqms_contracts_contract_no_key UNIQUE (contract_no);


--
-- Name: bqms_contracts bqms_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_contracts
    ADD CONSTRAINT bqms_contracts_pkey PRIMARY KEY (id);


--
-- Name: bqms_deliveries bqms_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_deliveries
    ADD CONSTRAINT bqms_deliveries_pkey PRIMARY KEY (id);


--
-- Name: bqms_dossier_jobs bqms_dossier_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_dossier_jobs
    ADD CONSTRAINT bqms_dossier_jobs_pkey PRIMARY KEY (id);


--
-- Name: bqms_image_index bqms_image_index_bqms_code_image_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_image_index
    ADD CONSTRAINT bqms_image_index_bqms_code_image_path_key UNIQUE (bqms_code, image_path);


--
-- Name: bqms_image_index bqms_image_index_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_image_index
    ADD CONSTRAINT bqms_image_index_pkey PRIMARY KEY (id);


--
-- Name: bqms_manufacturing_daily bqms_manufacturing_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_manufacturing_daily
    ADD CONSTRAINT bqms_manufacturing_daily_pkey PRIMARY KEY (id);


--
-- Name: bqms_manufacturing_schedule bqms_manufacturing_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_manufacturing_schedule
    ADD CONSTRAINT bqms_manufacturing_schedule_pkey PRIMARY KEY (id);


--
-- Name: bqms_material_pricing bqms_material_pricing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_material_pricing
    ADD CONSTRAINT bqms_material_pricing_pkey PRIMARY KEY (id);


--
-- Name: bqms_monthly_po_summary bqms_monthly_po_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_monthly_po_summary
    ADD CONSTRAINT bqms_monthly_po_summary_pkey PRIMARY KEY (id);


--
-- Name: bqms_orders bqms_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_orders
    ADD CONSTRAINT bqms_orders_pkey PRIMARY KEY (id);


--
-- Name: bqms_qt_events bqms_qt_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_qt_events
    ADD CONSTRAINT bqms_qt_events_pkey PRIMARY KEY (id);


--
-- Name: bqms_quotation_items bqms_quotation_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_quotation_items
    ADD CONSTRAINT bqms_quotation_items_pkey PRIMARY KEY (id);


--
-- Name: bqms_quote_batch_items bqms_quote_batch_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_quote_batch_items
    ADD CONSTRAINT bqms_quote_batch_items_pkey PRIMARY KEY (id);


--
-- Name: bqms_quote_batches bqms_quote_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_quote_batches
    ADD CONSTRAINT bqms_quote_batches_pkey PRIMARY KEY (id);


--
-- Name: bqms_quote_log bqms_quote_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_quote_log
    ADD CONSTRAINT bqms_quote_log_pkey PRIMARY KEY (id);


--
-- Name: bqms_raw_material_po bqms_raw_material_po_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_raw_material_po
    ADD CONSTRAINT bqms_raw_material_po_pkey PRIMARY KEY (id);


--
-- Name: bqms_records bqms_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_records
    ADD CONSTRAINT bqms_records_pkey PRIMARY KEY (id);


--
-- Name: bqms_records bqms_records_po_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_records
    ADD CONSTRAINT bqms_records_po_no_key UNIQUE (po_no);


--
-- Name: bqms_rfq bqms_rfq_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_rfq
    ADD CONSTRAINT bqms_rfq_pkey PRIMARY KEY (id);


--
-- Name: bqms_rfq_submissions bqms_rfq_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_rfq_submissions
    ADD CONSTRAINT bqms_rfq_submissions_pkey PRIMARY KEY (id);


--
-- Name: bqms_row_gaps bqms_row_gaps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_row_gaps
    ADD CONSTRAINT bqms_row_gaps_pkey PRIMARY KEY (id);


--
-- Name: bqms_samsung_po bqms_samsung_po_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_samsung_po
    ADD CONSTRAINT bqms_samsung_po_pkey PRIMARY KEY (id);


--
-- Name: bqms_samsung_po bqms_samsung_po_po_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_samsung_po
    ADD CONSTRAINT bqms_samsung_po_po_number_key UNIQUE (po_number);


--
-- Name: bqms_scrape_presence bqms_scrape_presence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_scrape_presence
    ADD CONSTRAINT bqms_scrape_presence_pkey PRIMARY KEY (id);


--
-- Name: bqms_vendor_portal_staging bqms_vendor_portal_staging_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_vendor_portal_staging
    ADD CONSTRAINT bqms_vendor_portal_staging_pkey PRIMARY KEY (id);


--
-- Name: bqms_won_quotations bqms_won_quotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_won_quotations
    ADD CONSTRAINT bqms_won_quotations_pkey PRIMARY KEY (id);


--
-- Name: budget_targets budget_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_targets
    ADD CONSTRAINT budget_targets_pkey PRIMARY KEY (id);


--
-- Name: calendar_events calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);


--
-- Name: cash_book_categories cash_book_categories_category_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_book_categories
    ADD CONSTRAINT cash_book_categories_category_code_key UNIQUE (category_code);


--
-- Name: cash_book_categories cash_book_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_book_categories
    ADD CONSTRAINT cash_book_categories_pkey PRIMARY KEY (id);


--
-- Name: cash_book cash_book_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_book
    ADD CONSTRAINT cash_book_pkey PRIMARY KEY (id);


--
-- Name: companies companies_company_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_company_code_key UNIQUE (company_code);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: companies companies_tax_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_tax_code_key UNIQUE (tax_code);


--
-- Name: contract_price_items contract_price_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_price_items
    ADD CONSTRAINT contract_price_items_pkey PRIMARY KEY (id);


--
-- Name: crm_account_external_map crm_account_external_map_customer_id_source_system_match_fi_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_account_external_map
    ADD CONSTRAINT crm_account_external_map_customer_id_source_system_match_fi_key UNIQUE (customer_id, source_system, match_field, match_value);


--
-- Name: crm_account_external_map crm_account_external_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_account_external_map
    ADD CONSTRAINT crm_account_external_map_pkey PRIMARY KEY (id);


--
-- Name: crm_contacts crm_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_pkey PRIMARY KEY (id);


--
-- Name: crm_interactions crm_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_interactions
    ADD CONSTRAINT crm_interactions_pkey PRIMARY KEY (id);


--
-- Name: crm_pipeline_cards crm_pipeline_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_pipeline_cards
    ADD CONSTRAINT crm_pipeline_cards_pkey PRIMARY KEY (id);


--
-- Name: customer_contacts customer_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_contacts
    ADD CONSTRAINT customer_contacts_pkey PRIMARY KEY (id);


--
-- Name: customers customers_customer_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_customer_code_key UNIQUE (customer_code);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: customs_declaration_items customs_declaration_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_declaration_items
    ADD CONSTRAINT customs_declaration_items_pkey PRIMARY KEY (id);


--
-- Name: customs_declarations customs_declarations_declaration_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_declarations
    ADD CONSTRAINT customs_declarations_declaration_number_key UNIQUE (declaration_number);


--
-- Name: customs_declarations customs_declarations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_declarations
    ADD CONSTRAINT customs_declarations_pkey PRIMARY KEY (id);


--
-- Name: data_quality_checks data_quality_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_quality_checks
    ADD CONSTRAINT data_quality_checks_pkey PRIMARY KEY (id);


--
-- Name: deal_margins deal_margins_chain_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_margins
    ADD CONSTRAINT deal_margins_chain_code_key UNIQUE (chain_code);


--
-- Name: deal_margins deal_margins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_margins
    ADD CONSTRAINT deal_margins_pkey PRIMARY KEY (id);


--
-- Name: delivery_receipts delivery_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_receipts
    ADD CONSTRAINT delivery_receipts_pkey PRIMARY KEY (id);


--
-- Name: delivery_receipts delivery_receipts_receipt_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_receipts
    ADD CONSTRAINT delivery_receipts_receipt_number_key UNIQUE (receipt_number);


--
-- Name: demand_forecasts demand_forecasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demand_forecasts
    ADD CONSTRAINT demand_forecasts_pkey PRIMARY KEY (id);


--
-- Name: dim_date dim_date_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dim_date
    ADD CONSTRAINT dim_date_pkey PRIMARY KEY (date_key);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: domain_events domain_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domain_events
    ADD CONSTRAINT domain_events_pkey PRIMARY KEY (id);


--
-- Name: e_invoices e_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.e_invoices
    ADD CONSTRAINT e_invoices_pkey PRIMARY KEY (id);


--
-- Name: email_history email_history_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_history
    ADD CONSTRAINT email_history_message_id_key UNIQUE (message_id);


--
-- Name: email_history email_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_history
    ADD CONSTRAINT email_history_pkey PRIMARY KEY (id);


--
-- Name: employee_monthly_kpi employee_monthly_kpi_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_monthly_kpi
    ADD CONSTRAINT employee_monthly_kpi_pkey PRIMARY KEY (id);


--
-- Name: error_log error_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_log
    ADD CONSTRAINT error_log_pkey PRIMARY KEY (id);


--
-- Name: etl_sync_log etl_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etl_sync_log
    ADD CONSTRAINT etl_sync_log_pkey PRIMARY KEY (id);


--
-- Name: exchange_rates exchange_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rates
    ADD CONSTRAINT exchange_rates_pkey PRIMARY KEY (id);


--
-- Name: file_meta file_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_meta
    ADD CONSTRAINT file_meta_pkey PRIMARY KEY (id);


--
-- Name: file_meta file_meta_stored_filename_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_meta
    ADD CONSTRAINT file_meta_stored_filename_key UNIQUE (stored_filename);


--
-- Name: file_review_status file_review_status_file_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_review_status
    ADD CONSTRAINT file_review_status_file_path_key UNIQUE (file_path);


--
-- Name: file_review_status file_review_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_review_status
    ADD CONSTRAINT file_review_status_pkey PRIMARY KEY (id);


--
-- Name: fiscal_periods fiscal_periods_period_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_period_code_key UNIQUE (period_code);


--
-- Name: fiscal_periods fiscal_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_pkey PRIMARY KEY (id);


--
-- Name: help_articles help_articles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.help_articles
    ADD CONSTRAINT help_articles_pkey PRIMARY KEY (id);


--
-- Name: help_articles help_articles_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.help_articles
    ADD CONSTRAINT help_articles_slug_key UNIQUE (slug);


--
-- Name: hs_codes hs_codes_hs_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hs_codes
    ADD CONSTRAINT hs_codes_hs_code_key UNIQUE (hs_code);


--
-- Name: hs_codes hs_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hs_codes
    ADD CONSTRAINT hs_codes_pkey PRIMARY KEY (id);


--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (key);


--
-- Name: import_export_tracking import_export_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_export_tracking
    ADD CONSTRAINT import_export_tracking_pkey PRIMARY KEY (id);


--
-- Name: imv_consolidated imv_consolidated_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_consolidated
    ADD CONSTRAINT imv_consolidated_pkey PRIMARY KEY (id);


--
-- Name: imv_contracts imv_contracts_contract_id_item_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_contracts
    ADD CONSTRAINT imv_contracts_contract_id_item_code_key UNIQUE (contract_id, item_code);


--
-- Name: imv_contracts imv_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_contracts
    ADD CONSTRAINT imv_contracts_pkey PRIMARY KEY (id);


--
-- Name: imv_deliveries imv_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_deliveries
    ADD CONSTRAINT imv_deliveries_pkey PRIMARY KEY (id);


--
-- Name: imv_deliveries imv_deliveries_shipment_id_item_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_deliveries
    ADD CONSTRAINT imv_deliveries_shipment_id_item_code_key UNIQUE (shipment_id, item_code);


--
-- Name: imv_inquiries imv_inquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_inquiries
    ADD CONSTRAINT imv_inquiries_pkey PRIMARY KEY (id);


--
-- Name: imv_orders imv_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_orders
    ADD CONSTRAINT imv_orders_pkey PRIMARY KEY (id);


--
-- Name: imv_orders imv_orders_po_internal_number_item_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_orders
    ADD CONSTRAINT imv_orders_po_internal_number_item_code_key UNIQUE (po_internal_number, item_code);


--
-- Name: imv_payments imv_payments_invoice_id_item_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_payments
    ADD CONSTRAINT imv_payments_invoice_id_item_code_key UNIQUE (invoice_id, item_code);


--
-- Name: imv_payments imv_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_payments
    ADD CONSTRAINT imv_payments_pkey PRIMARY KEY (id);


--
-- Name: imv_purchase_orders imv_purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_purchase_orders
    ADD CONSTRAINT imv_purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: imv_rejections imv_rejections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_rejections
    ADD CONSTRAINT imv_rejections_pkey PRIMARY KEY (id);


--
-- Name: imv_rejections imv_rejections_rejection_id_item_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_rejections
    ADD CONSTRAINT imv_rejections_rejection_id_item_code_key UNIQUE (rejection_id, item_code);


--
-- Name: imv_rfq imv_rfq_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_rfq
    ADD CONSTRAINT imv_rfq_pkey PRIMARY KEY (id);


--
-- Name: imv_rfq imv_rfq_rfq_number_item_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_rfq
    ADD CONSTRAINT imv_rfq_rfq_number_item_code_key UNIQUE (rfq_number, item_code);


--
-- Name: imv_sync_log imv_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_sync_log
    ADD CONSTRAINT imv_sync_log_pkey PRIMARY KEY (id);


--
-- Name: inventory_movements inventory_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (id);


--
-- Name: inventory inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);


--
-- Name: inventory inventory_product_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_product_code_key UNIQUE (product_code);


--
-- Name: invoice_items invoice_items_invoice_id_line_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_line_number_key UNIQUE (invoice_id, line_number);


--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: leave_balance leave_balance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_balance
    ADD CONSTRAINT leave_balance_pkey PRIMARY KEY (id);


--
-- Name: leave_balance leave_balance_user_id_period_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_balance
    ADD CONSTRAINT leave_balance_user_id_period_year_key UNIQUE (user_id, period_year);


--
-- Name: leave_policy leave_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_policy
    ADD CONSTRAINT leave_policy_pkey PRIMARY KEY (id);


--
-- Name: leave_requests leave_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_pkey PRIMARY KEY (id);


--
-- Name: market_prices market_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_prices
    ADD CONSTRAINT market_prices_pkey PRIMARY KEY (id);


--
-- Name: material_types material_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_types
    ADD CONSTRAINT material_types_pkey PRIMARY KEY (id);


--
-- Name: material_types material_types_type_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_types
    ADD CONSTRAINT material_types_type_code_key UNIQUE (type_code);


--
-- Name: mv_refresh_log mv_refresh_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mv_refresh_log
    ADD CONSTRAINT mv_refresh_log_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: ocr_results ocr_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_results
    ADD CONSTRAINT ocr_results_pkey PRIMARY KEY (id);


--
-- Name: onedrive_file_index onedrive_file_index_graph_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onedrive_file_index
    ADD CONSTRAINT onedrive_file_index_graph_item_id_key UNIQUE (graph_item_id);


--
-- Name: onedrive_file_index onedrive_file_index_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onedrive_file_index
    ADD CONSTRAINT onedrive_file_index_pkey PRIMARY KEY (id);


--
-- Name: payment_requests payment_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_pkey PRIMARY KEY (id);


--
-- Name: payment_transactions payment_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_pkey PRIMARY KEY (id);


--
-- Name: pet_exp_log pet_exp_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pet_exp_log
    ADD CONSTRAINT pet_exp_log_pkey PRIMARY KEY (id);


--
-- Name: pet_species_catalog pet_species_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pet_species_catalog
    ADD CONSTRAINT pet_species_catalog_pkey PRIMARY KEY (species);


--
-- Name: pim_enrichment_audit pim_enrichment_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pim_enrichment_audit
    ADD CONSTRAINT pim_enrichment_audit_pkey PRIMARY KEY (id);


--
-- Name: po_line_items po_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_line_items
    ADD CONSTRAINT po_line_items_pkey PRIMARY KEY (id);


--
-- Name: price_history price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_pkey PRIMARY KEY (id);


--
-- Name: price_intel_config price_intel_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_intel_config
    ADD CONSTRAINT price_intel_config_pkey PRIMARY KEY (key);


--
-- Name: procrastinate_events procrastinate_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procrastinate_events
    ADD CONSTRAINT procrastinate_events_pkey PRIMARY KEY (id);


--
-- Name: procrastinate_jobs procrastinate_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procrastinate_jobs
    ADD CONSTRAINT procrastinate_jobs_pkey PRIMARY KEY (id);


--
-- Name: procrastinate_periodic_defers procrastinate_periodic_defers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procrastinate_periodic_defers
    ADD CONSTRAINT procrastinate_periodic_defers_pkey PRIMARY KEY (id);


--
-- Name: procrastinate_periodic_defers procrastinate_periodic_defers_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procrastinate_periodic_defers
    ADD CONSTRAINT procrastinate_periodic_defers_unique UNIQUE (task_name, periodic_id, defer_timestamp);


--
-- Name: procurement_audit_log procurement_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_audit_log
    ADD CONSTRAINT procurement_audit_log_pkey PRIMARY KEY (id);


--
-- Name: procurement_awards procurement_awards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_awards
    ADD CONSTRAINT procurement_awards_pkey PRIMARY KEY (id);


--
-- Name: procurement_bid_tokens procurement_bid_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_bid_tokens
    ADD CONSTRAINT procurement_bid_tokens_pkey PRIMARY KEY (id);


--
-- Name: procurement_bid_tokens procurement_bid_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_bid_tokens
    ADD CONSTRAINT procurement_bid_tokens_token_key UNIQUE (token);


--
-- Name: procurement_contract_items procurement_contract_items_contract_id_item_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_contract_items
    ADD CONSTRAINT procurement_contract_items_contract_id_item_no_key UNIQUE (contract_id, item_no);


--
-- Name: procurement_contract_items procurement_contract_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_contract_items
    ADD CONSTRAINT procurement_contract_items_pkey PRIMARY KEY (id);


--
-- Name: procurement_contracts procurement_contracts_contract_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_contracts
    ADD CONSTRAINT procurement_contracts_contract_no_key UNIQUE (contract_no);


--
-- Name: procurement_contracts procurement_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_contracts
    ADD CONSTRAINT procurement_contracts_pkey PRIMARY KEY (id);


--
-- Name: procurement_deliveries procurement_deliveries_delivery_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_deliveries
    ADD CONSTRAINT procurement_deliveries_delivery_no_key UNIQUE (delivery_no);


--
-- Name: procurement_deliveries procurement_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_deliveries
    ADD CONSTRAINT procurement_deliveries_pkey PRIMARY KEY (id);


--
-- Name: procurement_delivery_items procurement_delivery_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_delivery_items
    ADD CONSTRAINT procurement_delivery_items_pkey PRIMARY KEY (id);


--
-- Name: procurement_po_items procurement_po_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_po_items
    ADD CONSTRAINT procurement_po_items_pkey PRIMARY KEY (id);


--
-- Name: procurement_po_items procurement_po_items_po_id_item_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_po_items
    ADD CONSTRAINT procurement_po_items_po_id_item_no_key UNIQUE (po_id, item_no);


--
-- Name: procurement_pos procurement_pos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_pos
    ADD CONSTRAINT procurement_pos_pkey PRIMARY KEY (id);


--
-- Name: procurement_pos procurement_pos_po_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_pos
    ADD CONSTRAINT procurement_pos_po_no_key UNIQUE (po_no);


--
-- Name: procurement_rfq_batches procurement_rfq_batches_batch_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_batches
    ADD CONSTRAINT procurement_rfq_batches_batch_code_key UNIQUE (batch_code);


--
-- Name: procurement_rfq_batches procurement_rfq_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_batches
    ADD CONSTRAINT procurement_rfq_batches_pkey PRIMARY KEY (id);


--
-- Name: procurement_rfq_invitations procurement_rfq_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_invitations
    ADD CONSTRAINT procurement_rfq_invitations_pkey PRIMARY KEY (id);


--
-- Name: procurement_rfq_items procurement_rfq_items_batch_id_item_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_items
    ADD CONSTRAINT procurement_rfq_items_batch_id_item_no_key UNIQUE (batch_id, item_no);


--
-- Name: procurement_rfq_items procurement_rfq_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_items
    ADD CONSTRAINT procurement_rfq_items_pkey PRIMARY KEY (id);


--
-- Name: procurement_rfq_messages procurement_rfq_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_messages
    ADD CONSTRAINT procurement_rfq_messages_pkey PRIMARY KEY (id);


--
-- Name: procurement_rfq_shared_files procurement_rfq_shared_files_item_id_kind_file_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_shared_files
    ADD CONSTRAINT procurement_rfq_shared_files_item_id_kind_file_name_key UNIQUE (item_id, kind, file_name);


--
-- Name: procurement_rfq_shared_files procurement_rfq_shared_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_shared_files
    ADD CONSTRAINT procurement_rfq_shared_files_pkey PRIMARY KEY (id);


--
-- Name: products products_bqms_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_bqms_code_key UNIQUE (bqms_code);


--
-- Name: products products_imv_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_imv_code_key UNIQUE (imv_code);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: profit_reports profit_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_reports
    ADD CONSTRAINT profit_reports_pkey PRIMARY KEY (id);


--
-- Name: public_holidays public_holidays_holiday_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_holidays
    ADD CONSTRAINT public_holidays_holiday_date_key UNIQUE (holiday_date);


--
-- Name: public_holidays public_holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_holidays
    ADD CONSTRAINT public_holidays_pkey PRIMARY KEY (id);


--
-- Name: purchase_invoices_q purchase_invoices_q_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_invoices_q
    ADD CONSTRAINT purchase_invoices_q_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_po_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_po_number_key UNIQUE (po_number);


--
-- Name: quotation_templates quotation_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_templates
    ADD CONSTRAINT quotation_templates_pkey PRIMARY KEY (id);


--
-- Name: quotations quotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_pkey PRIMARY KEY (id);


--
-- Name: quote_batches quote_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_batches
    ADD CONSTRAINT quote_batches_pkey PRIMARY KEY (id);


--
-- Name: quote_batches quote_batches_quote_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_batches
    ADD CONSTRAINT quote_batches_quote_no_key UNIQUE (quote_no);


--
-- Name: report_executions report_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_executions
    ADD CONSTRAINT report_executions_pkey PRIMARY KEY (id);


--
-- Name: retry_queue retry_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retry_queue
    ADD CONSTRAINT retry_queue_pkey PRIMARY KEY (id);


--
-- Name: revenue_chain revenue_chain_chain_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_chain
    ADD CONSTRAINT revenue_chain_chain_code_key UNIQUE (chain_code);


--
-- Name: revenue_chain revenue_chain_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_chain
    ADD CONSTRAINT revenue_chain_pkey PRIMARY KEY (id);


--
-- Name: revenue_invoices revenue_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_invoices
    ADD CONSTRAINT revenue_invoices_pkey PRIMARY KEY (id);


--
-- Name: rfq_line_items rfq_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_line_items
    ADD CONSTRAINT rfq_line_items_pkey PRIMARY KEY (id);


--
-- Name: rfq_quotations rfq_quotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_quotations
    ADD CONSTRAINT rfq_quotations_pkey PRIMARY KEY (id);


--
-- Name: rfq_requests rfq_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_requests
    ADD CONSTRAINT rfq_requests_pkey PRIMARY KEY (id);


--
-- Name: rfq_requests rfq_requests_rfq_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_requests
    ADD CONSTRAINT rfq_requests_rfq_number_key UNIQUE (rfq_number);


--
-- Name: sales_invoices_q sales_invoices_q_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoices_q
    ADD CONSTRAINT sales_invoices_q_pkey PRIMARY KEY (id);


--
-- Name: sales_order_items sales_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_items
    ADD CONSTRAINT sales_order_items_pkey PRIMARY KEY (id);


--
-- Name: sales_orders sales_orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_order_number_key UNIQUE (order_number);


--
-- Name: sales_orders sales_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_pkey PRIMARY KEY (id);


--
-- Name: samsung_watchdog_events samsung_watchdog_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.samsung_watchdog_events
    ADD CONSTRAINT samsung_watchdog_events_pkey PRIMARY KEY (id);


--
-- Name: scheduled_reports scheduled_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_reports
    ADD CONSTRAINT scheduled_reports_pkey PRIMARY KEY (id);


--
-- Name: security_log security_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_log
    ADD CONSTRAINT security_log_pkey PRIMARY KEY (id);


--
-- Name: shipment_items shipment_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_items
    ADD CONSTRAINT shipment_items_pkey PRIMARY KEY (id);


--
-- Name: shipments shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);


--
-- Name: shipments shipments_shipment_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_shipment_number_key UNIQUE (shipment_number);


--
-- Name: sourcing_entries sourcing_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_entries
    ADD CONSTRAINT sourcing_entries_pkey PRIMARY KEY (id);


--
-- Name: sourcing_order_status_history sourcing_order_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_order_status_history
    ADD CONSTRAINT sourcing_order_status_history_pkey PRIMARY KEY (id);


--
-- Name: sourcing_orders sourcing_orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_orders
    ADD CONSTRAINT sourcing_orders_order_number_key UNIQUE (order_number);


--
-- Name: sourcing_orders sourcing_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_orders
    ADD CONSTRAINT sourcing_orders_pkey PRIMARY KEY (id);


--
-- Name: sourcing_pricing_rules_history sourcing_pricing_rules_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_pricing_rules_history
    ADD CONSTRAINT sourcing_pricing_rules_history_pkey PRIMARY KEY (id);


--
-- Name: sourcing_pricing_rules sourcing_pricing_rules_item_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_pricing_rules
    ADD CONSTRAINT sourcing_pricing_rules_item_type_key UNIQUE (item_type);


--
-- Name: sourcing_pricing_rules sourcing_pricing_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_pricing_rules
    ADD CONSTRAINT sourcing_pricing_rules_pkey PRIMARY KEY (id);


--
-- Name: sourcing_pricing_snapshots sourcing_pricing_snapshots_entry_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_pricing_snapshots
    ADD CONSTRAINT sourcing_pricing_snapshots_entry_id_version_key UNIQUE (entry_id, version);


--
-- Name: sourcing_pricing_snapshots sourcing_pricing_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_pricing_snapshots
    ADD CONSTRAINT sourcing_pricing_snapshots_pkey PRIMARY KEY (id);


--
-- Name: sourcing_supplier_prices sourcing_supplier_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_supplier_prices
    ADD CONSTRAINT sourcing_supplier_prices_pkey PRIMARY KEY (id);


--
-- Name: sourcing_vn_shipping_history sourcing_vn_shipping_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_vn_shipping_history
    ADD CONSTRAINT sourcing_vn_shipping_history_pkey PRIMARY KEY (id);


--
-- Name: stock_alerts stock_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_alerts
    ADD CONSTRAINT stock_alerts_pkey PRIMARY KEY (id);


--
-- Name: supplier_contracts supplier_contracts_contract_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_contracts
    ADD CONSTRAINT supplier_contracts_contract_number_key UNIQUE (contract_number);


--
-- Name: supplier_contracts supplier_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_contracts
    ADD CONSTRAINT supplier_contracts_pkey PRIMARY KEY (id);


--
-- Name: supplier_product_map supplier_product_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_product_map
    ADD CONSTRAINT supplier_product_map_pkey PRIMARY KEY (id);


--
-- Name: supplier_product_map supplier_product_map_supplier_id_bqms_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_product_map
    ADD CONSTRAINT supplier_product_map_supplier_id_bqms_code_key UNIQUE (supplier_id, bqms_code);


--
-- Name: supplier_quote_items supplier_quote_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_quote_items
    ADD CONSTRAINT supplier_quote_items_pkey PRIMARY KEY (id);


--
-- Name: supplier_quote_items supplier_quote_items_quote_id_line_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_quote_items
    ADD CONSTRAINT supplier_quote_items_quote_id_line_number_key UNIQUE (quote_id, line_number);


--
-- Name: supplier_quotes supplier_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_quotes
    ADD CONSTRAINT supplier_quotes_pkey PRIMARY KEY (id);


--
-- Name: supplier_quotes supplier_quotes_quote_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_quotes
    ADD CONSTRAINT supplier_quotes_quote_number_key UNIQUE (quote_number);


--
-- Name: supplier_ratings supplier_ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_ratings
    ADD CONSTRAINT supplier_ratings_pkey PRIMARY KEY (id);


--
-- Name: supplier_ratings supplier_ratings_supplier_id_period_year_period_quarter_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_ratings
    ADD CONSTRAINT supplier_ratings_supplier_id_period_year_period_quarter_key UNIQUE (supplier_id, period_year, period_quarter);


--
-- Name: supplier_scores supplier_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_scores
    ADD CONSTRAINT supplier_scores_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: system_config system_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT system_config_pkey PRIMARY KEY (key);


--
-- Name: system_health_checks system_health_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_health_checks
    ADD CONSTRAINT system_health_checks_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_setting_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_setting_key_key UNIQUE (setting_key);


--
-- Name: taggings taggings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taggings
    ADD CONSTRAINT taggings_pkey PRIMARY KEY (id);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: tags tags_tag_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_tag_name_key UNIQUE (tag_name);


--
-- Name: task_assignments task_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignments
    ADD CONSTRAINT task_assignments_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: e_invoices uq_e_invoice; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.e_invoices
    ADD CONSTRAINT uq_e_invoice UNIQUE (e_invoice_symbol, e_invoice_number);


--
-- Name: employee_monthly_kpi uq_emp_kpi_period; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_monthly_kpi
    ADD CONSTRAINT uq_emp_kpi_period UNIQUE (user_id, period_year, period_month);


--
-- Name: exchange_rates uq_exchange_rate; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rates
    ADD CONSTRAINT uq_exchange_rate UNIQUE (rate_date, from_currency, to_currency, rate_type);


--
-- Name: supplier_scores uq_supplier_score_date; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_scores
    ADD CONSTRAINT uq_supplier_score_date UNIQUE (supplier_id, score_date);


--
-- Name: taggings uq_tagging; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taggings
    ADD CONSTRAINT uq_tagging UNIQUE (tag_id, ref_type, ref_id);


--
-- Name: user_activity_log user_activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity_log
    ADD CONSTRAINT user_activity_log_pkey PRIMARY KEY (id);


--
-- Name: user_pets user_pets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_pets
    ADD CONSTRAINT user_pets_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_session_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_session_token_key UNIQUE (session_token);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_m365_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_m365_id_key UNIQUE (m365_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vendor_accounts vendor_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_accounts
    ADD CONSTRAINT vendor_accounts_pkey PRIMARY KEY (id);


--
-- Name: vendor_accounts vendor_accounts_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_accounts
    ADD CONSTRAINT vendor_accounts_user_id_key UNIQUE (user_id);


--
-- Name: vendor_quote_items vendor_quote_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_quote_items
    ADD CONSTRAINT vendor_quote_items_pkey PRIMARY KEY (id);


--
-- Name: vendor_quote_items vendor_quote_items_quote_id_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_quote_items
    ADD CONSTRAINT vendor_quote_items_quote_id_item_id_key UNIQUE (quote_id, item_id);


--
-- Name: vendor_quotes vendor_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_quotes
    ADD CONSTRAINT vendor_quotes_pkey PRIMARY KEY (id);


--
-- Name: workflow_history workflow_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_history
    ADD CONSTRAINT workflow_history_pkey PRIMARY KEY (id);


--
-- Name: workflow_instances workflow_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instances
    ADD CONSTRAINT workflow_instances_pkey PRIMARY KEY (id);


--
-- Name: xnk_price_lookup xnk_price_lookup_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xnk_price_lookup
    ADD CONSTRAINT xnk_price_lookup_pkey PRIMARY KEY (id);


--
-- Name: idx_ai_class_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_class_result ON public.ai_classification_results USING btree (classification);


--
-- Name: idx_ai_class_rfq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_class_rfq ON public.ai_classification_results USING btree (rfq_id);


--
-- Name: idx_ai_dept_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_dept_date ON public.attendance_incidents USING btree (department, incident_date DESC);


--
-- Name: idx_ai_type_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_type_date ON public.attendance_incidents USING btree (incident_type, incident_date DESC);


--
-- Name: idx_ai_unacked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_unacked ON public.attendance_incidents USING btree (department) WHERE (acknowledged_at IS NULL);


--
-- Name: idx_ai_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_user_date ON public.attendance_incidents USING btree (user_id, incident_date DESC);


--
-- Name: idx_aicr_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aicr_batch ON public.ai_classification_results USING btree (batch_id);


--
-- Name: idx_aicr_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aicr_class ON public.ai_classification_results USING btree (classification);


--
-- Name: idx_aicr_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aicr_created ON public.ai_classification_results USING btree (created_at DESC);


--
-- Name: idx_aicr_rfq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aicr_rfq ON public.ai_classification_results USING btree (rfq_id);


--
-- Name: idx_ap_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ap_due ON public.accounts_payable USING btree (due_date);


--
-- Name: idx_ap_overdue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ap_overdue ON public.accounts_payable USING btree (due_date) WHERE (status = ANY (ARRAY['pending'::public.payment_status, 'partial_paid'::public.payment_status]));


--
-- Name: idx_ap_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ap_po ON public.accounts_payable USING btree (po_id);


--
-- Name: idx_ap_procurement_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ap_procurement_po ON public.accounts_payable USING btree (procurement_po_id) WHERE (procurement_po_id IS NOT NULL);


--
-- Name: idx_ap_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ap_status ON public.accounts_payable USING btree (status);


--
-- Name: idx_ap_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ap_supplier ON public.accounts_payable USING btree (supplier_id);


--
-- Name: idx_ar_chain_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ar_chain_code ON public.accounts_receivable USING btree (chain_code) WHERE (chain_code IS NOT NULL);


--
-- Name: idx_ar_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ar_customer ON public.accounts_receivable USING btree (customer_id);


--
-- Name: idx_ar_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ar_due ON public.accounts_receivable USING btree (due_date);


--
-- Name: idx_ar_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ar_invoice ON public.accounts_receivable USING btree (invoice_id);


--
-- Name: idx_ar_overdue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ar_overdue ON public.accounts_receivable USING btree (due_date) WHERE (status = ANY (ARRAY['pending'::public.payment_status, 'partial_paid'::public.payment_status]));


--
-- Name: idx_ar_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ar_status ON public.accounts_receivable USING btree (status);


--
-- Name: idx_audit_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_action ON public.audit_log USING btree (action);


--
-- Name: idx_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_created ON public.audit_log USING btree (created_at DESC);


--
-- Name: idx_audit_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_record ON public.audit_log USING btree (table_name, record_id);


--
-- Name: idx_audit_table; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_table ON public.audit_log USING btree (table_name);


--
-- Name: idx_audit_table_action_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_table_action_created ON public.audit_log USING btree (table_name, action, created_at) WHERE (action = 'INSERT'::text);


--
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user ON public.audit_log USING btree (user_id);


--
-- Name: idx_bcon_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bcon_email ON public.bqms_contacts USING btree (email_username);


--
-- Name: idx_bcon_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bcon_name ON public.bqms_contacts USING btree (full_name);


--
-- Name: idx_bcpi_image_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bcpi_image_path ON public.bqms_code_primary_image USING btree (image_path);


--
-- Name: idx_bd_chain_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bd_chain_code ON public.bqms_deliveries USING btree (chain_code) WHERE (chain_code IS NOT NULL);


--
-- Name: idx_bd_po_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bd_po_number ON public.bqms_deliveries USING btree (po_number) WHERE (po_number IS NOT NULL);


--
-- Name: idx_bd_sourcing_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bd_sourcing_order ON public.bqms_deliveries USING btree (sourcing_order_id) WHERE (sourcing_order_id IS NOT NULL);


--
-- Name: idx_bdel_code_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bdel_code_trgm ON public.bqms_deliveries USING gin (bqms_code public.gin_trgm_ops);


--
-- Name: idx_bdel_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bdel_date ON public.bqms_deliveries USING btree (delivery_date);


--
-- Name: idx_bdel_po_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bdel_po_trgm ON public.bqms_deliveries USING gin (po_number public.gin_trgm_ops);


--
-- Name: idx_bdel_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bdel_product ON public.bqms_deliveries USING btree (product_id);


--
-- Name: idx_bdel_samsung_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bdel_samsung_po ON public.bqms_deliveries USING btree (samsung_po_id);


--
-- Name: idx_bdel_ship_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bdel_ship_trgm ON public.bqms_deliveries USING gin (shipping_no public.gin_trgm_ops);


--
-- Name: idx_bdel_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bdel_status ON public.bqms_deliveries USING btree (delivery_status);


--
-- Name: idx_bii_bqms_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bii_bqms_code ON public.bqms_image_index USING btree (bqms_code);


--
-- Name: idx_bii_indexed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bii_indexed_at ON public.bqms_image_index USING btree (indexed_at);


--
-- Name: idx_bii_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bii_source ON public.bqms_image_index USING btree (source);


--
-- Name: idx_bl_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bl_created ON public.backup_log USING btree (created_at DESC);


--
-- Name: idx_bl_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bl_status ON public.backup_log USING btree (status, created_at DESC);


--
-- Name: idx_bmd_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bmd_date ON public.bqms_manufacturing_daily USING btree (delivery_date);


--
-- Name: idx_bmd_schedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bmd_schedule ON public.bqms_manufacturing_daily USING btree (schedule_id);


--
-- Name: idx_bmp_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bmp_product ON public.bqms_material_pricing USING btree (product_id);


--
-- Name: idx_bmp_rfq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bmp_rfq ON public.bqms_material_pricing USING btree (rfq_number);


--
-- Name: idx_bmps_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bmps_month ON public.bqms_monthly_po_summary USING btree (month_year);


--
-- Name: idx_bms_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bms_month ON public.bqms_manufacturing_schedule USING btree (schedule_month);


--
-- Name: idx_bms_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bms_product ON public.bqms_manufacturing_schedule USING btree (product_id);


--
-- Name: idx_border_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_border_customer ON public.bqms_orders USING btree (customer_id);


--
-- Name: idx_border_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_border_product ON public.bqms_orders USING btree (product_id);


--
-- Name: idx_border_rfq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_border_rfq ON public.bqms_orders USING btree (rfq_id);


--
-- Name: idx_border_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_border_status ON public.bqms_orders USING btree (status);


--
-- Name: idx_bqi_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqi_product ON public.bqms_quotation_items USING btree (product_id);


--
-- Name: idx_bqi_submission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqi_submission ON public.bqms_quotation_items USING btree (submission_id);


--
-- Name: idx_bqms_contacts_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_contacts_driver ON public.bqms_contacts USING btree (is_driver) WHERE (is_driver = true);


--
-- Name: idx_bqms_contract_items_bqms_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_contract_items_bqms_code ON public.bqms_contract_items USING btree (bqms_code);


--
-- Name: idx_bqms_contract_items_contract_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_contract_items_contract_id ON public.bqms_contract_items USING btree (contract_id);


--
-- Name: idx_bqms_contracts_contract_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_contracts_contract_start ON public.bqms_contracts USING btree (contract_start);


--
-- Name: idx_bqms_contracts_request_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_contracts_request_no ON public.bqms_contracts USING btree (request_no);


--
-- Name: idx_bqms_contracts_rfq_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_contracts_rfq_id ON public.bqms_contracts USING btree (rfq_id);


--
-- Name: idx_bqms_contracts_won_quot_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_contracts_won_quot_id ON public.bqms_contracts USING btree (won_quotation_id);


--
-- Name: idx_bqms_deliv_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_deliv_hash ON public.bqms_deliveries USING btree (source_hash) WHERE (source_hash IS NOT NULL);


--
-- Name: idx_bqms_deliveries_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_deliveries_driver ON public.bqms_deliveries USING btree (driver_id) WHERE (driver_id IS NOT NULL);


--
-- Name: idx_bqms_kpi; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bqms_kpi ON public.bqms_kpi USING btree (refreshed_at);


--
-- Name: idx_bqms_push_heartbeat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_push_heartbeat ON public.bqms_rfq USING btree (bqms_push_status, bqms_push_heartbeat_at) WHERE (bqms_push_status = ANY (ARRAY['queued'::text, 'running'::text]));


--
-- Name: idx_bqms_qt_events_rfq_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_qt_events_rfq_created ON public.bqms_qt_events USING btree (rfq_number, created_at);


--
-- Name: idx_bqms_rfq_assigned_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_rfq_assigned_to ON public.bqms_rfq USING btree (assigned_to);


--
-- Name: idx_bqms_rfq_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_rfq_chain ON public.bqms_rfq USING btree (chain_code) WHERE (chain_code IS NOT NULL);


--
-- Name: idx_bqms_rfq_classification_override; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_rfq_classification_override ON public.bqms_rfq USING btree (classification_override) WHERE (classification_override IS NOT NULL);


--
-- Name: idx_bqms_rfq_code_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_rfq_code_trgm ON public.bqms_rfq USING gin (bqms_code public.gin_trgm_ops);


--
-- Name: idx_bqms_rfq_deadline_awaiting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_rfq_deadline_awaiting ON public.bqms_rfq USING btree (deadline_dt) WHERE (qt_state = 'AWAITING_RESULT'::public.bqms_qt_state);


--
-- Name: idx_bqms_rfq_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_rfq_department ON public.bqms_rfq USING btree (department);


--
-- Name: idx_bqms_rfq_last_seen_scrape; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_rfq_last_seen_scrape ON public.bqms_rfq USING btree (last_seen_scrape_at);


--
-- Name: idx_bqms_rfq_push_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_rfq_push_status ON public.bqms_rfq USING btree (bqms_push_status) WHERE (bqms_push_status = ANY (ARRAY['queued'::text, 'running'::text]));


--
-- Name: idx_bqms_rfq_qt_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_rfq_qt_state ON public.bqms_rfq USING btree (qt_state);


--
-- Name: idx_bqms_rfq_quote_unlocked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_rfq_quote_unlocked ON public.bqms_rfq USING btree (quote_unlocked) WHERE (quote_unlocked = true);


--
-- Name: idx_bqms_rfq_so; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_rfq_so ON public.bqms_rfq USING btree (sales_order_id) WHERE (sales_order_id IS NOT NULL);


--
-- Name: idx_bqms_rfq_spec_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_rfq_spec_trgm ON public.bqms_rfq USING gin (specification public.gin_trgm_ops);


--
-- Name: idx_bqms_row_gaps_healed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_row_gaps_healed ON public.bqms_row_gaps USING btree (healed_at DESC) WHERE (healed_at IS NOT NULL);


--
-- Name: idx_bqms_row_gaps_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_row_gaps_open ON public.bqms_row_gaps USING btree (gap_type, rfq_number) WHERE (healed_at IS NULL);


--
-- Name: idx_bqms_row_gaps_rfq_lastattempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_row_gaps_rfq_lastattempt ON public.bqms_row_gaps USING btree (rfq_number, last_attempt_at DESC);


--
-- Name: idx_bqms_scrape_presence_rfq_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_scrape_presence_rfq_seen ON public.bqms_scrape_presence USING btree (rfq_number, seen_at DESC);


--
-- Name: idx_bqms_scrape_presence_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bqms_scrape_presence_run ON public.bqms_scrape_presence USING btree (scrape_run_id);


--
-- Name: idx_brec_rfq_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brec_rfq_sub ON public.bqms_records USING btree (rfq_submission_id);


--
-- Name: idx_brec_samsung; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brec_samsung ON public.bqms_records USING btree (samsung_po_id);


--
-- Name: idx_brec_sync; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brec_sync ON public.bqms_records USING btree (sync_status);


--
-- Name: idx_brfq_bqms_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brfq_bqms_code ON public.bqms_rfq USING btree (bqms_code) WHERE (bqms_code IS NOT NULL);


--
-- Name: idx_brfq_code_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brfq_code_norm ON public.bqms_rfq USING btree (bqms_code_norm) WHERE (bqms_code IS NOT NULL);


--
-- Name: idx_brfq_code_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brfq_code_trgm ON public.bqms_rfq USING gin (bqms_code public.gin_trgm_ops);


--
-- Name: idx_brfq_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brfq_date ON public.bqms_rfq USING btree (inquiry_date);


--
-- Name: idx_brfq_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brfq_number ON public.bqms_rfq USING btree (rfq_number);


--
-- Name: idx_brfq_pic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brfq_pic ON public.bqms_rfq USING btree (person_in_charge);


--
-- Name: idx_brfq_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brfq_product ON public.bqms_rfq USING btree (product_id);


--
-- Name: idx_brfq_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brfq_result ON public.bqms_rfq USING btree (result);


--
-- Name: idx_brfq_rfq_no_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brfq_rfq_no_trgm ON public.bqms_rfq USING gin (rfq_number public.gin_trgm_ops);


--
-- Name: idx_brfq_spec_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brfq_spec_trgm ON public.bqms_rfq USING gin (specification public.gin_trgm_ops);


--
-- Name: idx_brfq_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brfq_supplier ON public.bqms_rfq USING btree (supplier_id);


--
-- Name: idx_brmp_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brmp_pending ON public.bqms_raw_material_po USING btree (pending) WHERE (pending = true);


--
-- Name: idx_brmp_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brmp_product ON public.bqms_raw_material_po USING btree (product_id);


--
-- Name: idx_bspo_bqms_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bspo_bqms_code ON public.bqms_samsung_po USING btree (bqms_code) WHERE (bqms_code IS NOT NULL);


--
-- Name: idx_bspo_code_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bspo_code_trgm ON public.bqms_samsung_po USING gin (bqms_code public.gin_trgm_ops);


--
-- Name: idx_bspo_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bspo_date ON public.bqms_samsung_po USING btree (po_date);


--
-- Name: idx_bspo_po_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bspo_po_number ON public.bqms_samsung_po USING btree (po_number);


--
-- Name: idx_bspo_po_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bspo_po_trgm ON public.bqms_samsung_po USING gin (po_number public.gin_trgm_ops);


--
-- Name: idx_bspo_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bspo_product ON public.bqms_samsung_po USING btree (product_id);


--
-- Name: idx_bspo_raw_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bspo_raw_gin ON public.bqms_samsung_po USING gin (raw_data);


--
-- Name: idx_bspo_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bspo_status ON public.bqms_samsung_po USING btree (process_status);


--
-- Name: idx_bsub_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bsub_company ON public.bqms_rfq_submissions USING btree (company_id);


--
-- Name: idx_bsub_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bsub_customer ON public.bqms_rfq_submissions USING btree (customer_id);


--
-- Name: idx_bsub_rfq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bsub_rfq ON public.bqms_rfq_submissions USING btree (rfq_number);


--
-- Name: idx_bsub_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bsub_status ON public.bqms_rfq_submissions USING btree (status);


--
-- Name: idx_bsub_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bsub_workflow ON public.bqms_rfq_submissions USING btree (workflow_id);


--
-- Name: idx_bt_fiscal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bt_fiscal ON public.budget_targets USING btree (fiscal_year, fiscal_month);


--
-- Name: idx_bt_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bt_type ON public.budget_targets USING btree (target_type);


--
-- Name: idx_bvps_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bvps_module ON public.bqms_vendor_portal_staging USING btree (module);


--
-- Name: idx_bvps_rfq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bvps_rfq ON public.bqms_vendor_portal_staging USING btree (rfq_number);


--
-- Name: idx_bvps_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bvps_run ON public.bqms_vendor_portal_staging USING btree (scrape_run_id);


--
-- Name: idx_bvps_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bvps_status ON public.bqms_vendor_portal_staging USING btree (status);


--
-- Name: idx_bwq_code_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bwq_code_trgm ON public.bqms_won_quotations USING gin (bqms_code public.gin_trgm_ops);


--
-- Name: idx_bwq_hscode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bwq_hscode ON public.bqms_won_quotations USING btree (hs_code_id);


--
-- Name: idx_bwq_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bwq_product ON public.bqms_won_quotations USING btree (product_id);


--
-- Name: idx_bwq_rfq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bwq_rfq ON public.bqms_won_quotations USING btree (rfq_id);


--
-- Name: idx_bwq_rfq_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bwq_rfq_trgm ON public.bqms_won_quotations USING gin (rfq_number public.gin_trgm_ops);


--
-- Name: idx_cb_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cb_category ON public.cash_book USING btree (category_id);


--
-- Name: idx_cb_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cb_company ON public.cash_book USING btree (company_id);


--
-- Name: idx_cb_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cb_date ON public.cash_book USING btree (entry_date);


--
-- Name: idx_cb_direction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cb_direction ON public.cash_book USING btree (direction);


--
-- Name: idx_cd_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cd_created_by ON public.customs_declarations USING btree (created_by);


--
-- Name: idx_cd_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cd_date ON public.customs_declarations USING btree (declaration_date);


--
-- Name: idx_cd_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cd_status ON public.customs_declarations USING btree (status);


--
-- Name: idx_cd_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cd_type ON public.customs_declarations USING btree (declaration_type);


--
-- Name: idx_cdi_declaration; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cdi_declaration ON public.customs_declaration_items USING btree (declaration_id);


--
-- Name: idx_cdi_hscode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cdi_hscode ON public.customs_declaration_items USING btree (hs_code_id);


--
-- Name: idx_cdi_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cdi_product ON public.customs_declaration_items USING btree (product_id);


--
-- Name: idx_ce_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ce_date ON public.calendar_events USING btree (start_time);


--
-- Name: idx_ce_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ce_type ON public.calendar_events USING btree (event_type);


--
-- Name: idx_company_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_code ON public.companies USING btree (company_code);


--
-- Name: idx_cpi_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cpi_contract ON public.contract_price_items USING btree (contract_id);


--
-- Name: idx_cpi_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cpi_product ON public.contract_price_items USING btree (product_id);


--
-- Name: idx_cpi_valid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cpi_valid ON public.contract_price_items USING btree (valid_from, valid_to);


--
-- Name: idx_crm_interactions_follow_up; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_interactions_follow_up ON public.crm_interactions USING btree (follow_up_date) WHERE (follow_up_date IS NOT NULL);


--
-- Name: idx_crm_map_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_map_customer ON public.crm_account_external_map USING btree (customer_id);


--
-- Name: idx_crm_map_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_map_lookup ON public.crm_account_external_map USING btree (source_system, match_field);


--
-- Name: idx_crm_map_match_value_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_map_match_value_lower ON public.crm_account_external_map USING btree (lower(match_value));


--
-- Name: idx_crmc_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crmc_customer ON public.crm_contacts USING btree (customer_id);


--
-- Name: idx_crmc_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crmc_email ON public.crm_contacts USING btree (email);


--
-- Name: idx_crmi_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crmi_customer ON public.crm_interactions USING btree (customer_id, created_at DESC);


--
-- Name: idx_crmi_follow_up; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crmi_follow_up ON public.crm_interactions USING btree (follow_up_date) WHERE (follow_up_date IS NOT NULL);


--
-- Name: idx_crmi_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crmi_type ON public.crm_interactions USING btree (interaction_type);


--
-- Name: idx_cust_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cust_active ON public.customers USING btree (id) WHERE ((is_active = true) AND (deleted_at IS NULL));


--
-- Name: idx_cust_business; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cust_business ON public.customers USING btree (business_system);


--
-- Name: idx_cust_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cust_code ON public.customers USING btree (customer_code);


--
-- Name: idx_cust_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cust_name_trgm ON public.customers USING gin (company_name_unaccent public.gin_trgm_ops);


--
-- Name: idx_cust_tax; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cust_tax ON public.customers USING btree (tax_code) WHERE (tax_code IS NOT NULL);


--
-- Name: idx_custcontact_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custcontact_customer ON public.customer_contacts USING btree (customer_id);


--
-- Name: idx_custcontact_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custcontact_primary ON public.customer_contacts USING btree (customer_id) WHERE (is_primary = true);


--
-- Name: idx_customers_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_created_at ON public.customers USING btree (created_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_customers_industry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_industry ON public.customers USING btree (industry) WHERE (industry IS NOT NULL);


--
-- Name: idx_customers_lead_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_lead_source ON public.customers USING btree (lead_source) WHERE (lead_source IS NOT NULL);


--
-- Name: idx_customers_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_owner ON public.customers USING btree (owner_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_de_aggregate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_de_aggregate ON public.domain_events USING btree (aggregate_type, aggregate_id);


--
-- Name: idx_de_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_de_chain ON public.domain_events USING btree (chain_code) WHERE (chain_code IS NOT NULL);


--
-- Name: idx_de_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_de_created ON public.domain_events USING btree (created_at DESC);


--
-- Name: idx_de_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_de_event_type ON public.domain_events USING btree (event_type);


--
-- Name: idx_df_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_df_product ON public.demand_forecasts USING btree (product_id, forecast_date DESC);


--
-- Name: idx_dimdate_fiscal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dimdate_fiscal ON public.dim_date USING btree (fiscal_year, fiscal_quarter, fiscal_month);


--
-- Name: idx_dimdate_working; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dimdate_working ON public.dim_date USING btree (date_key) WHERE (is_working_day = true);


--
-- Name: idx_dimdate_year_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dimdate_year_month ON public.dim_date USING btree (year, month);


--
-- Name: idx_dm_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dm_chain ON public.deal_margins USING btree (chain_code);


--
-- Name: idx_dm_margin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dm_margin ON public.deal_margins USING btree (margin_pct);


--
-- Name: idx_dm_so; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dm_so ON public.deal_margins USING btree (sales_order_id) WHERE (sales_order_id IS NOT NULL);


--
-- Name: idx_doc_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_category ON public.documents USING btree (category);


--
-- Name: idx_doc_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_ref ON public.documents USING btree (ref_type, ref_id);


--
-- Name: idx_doc_title; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_title ON public.documents USING gin (to_tsvector('simple'::regconfig, title));


--
-- Name: idx_doc_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_user ON public.documents USING btree (uploaded_by);


--
-- Name: idx_dossier_jobs_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dossier_jobs_attempt ON public.bqms_dossier_jobs USING btree (sev_type, delivery_attempt_no, created_at DESC);


--
-- Name: idx_dossier_jobs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dossier_jobs_created ON public.bqms_dossier_jobs USING btree (created_at DESC);


--
-- Name: idx_dossier_jobs_heartbeat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dossier_jobs_heartbeat ON public.bqms_dossier_jobs USING btree (status, last_heartbeat_at) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));


--
-- Name: idx_dossier_jobs_po_array; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dossier_jobs_po_array ON public.bqms_dossier_jobs USING gin (po_numbers);


--
-- Name: idx_dossier_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dossier_jobs_status ON public.bqms_dossier_jobs USING btree (status) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text, 'invoice_ready'::text, 'po_downloaded'::text, 'excel_built'::text]));


--
-- Name: idx_dossier_jobs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dossier_jobs_user ON public.bqms_dossier_jobs USING btree (user_id, created_at DESC);


--
-- Name: idx_dqc_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dqc_status ON public.data_quality_checks USING btree (status, created_at DESC);


--
-- Name: idx_dqc_table; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dqc_table ON public.data_quality_checks USING btree (table_name, created_at DESC);


--
-- Name: idx_dr_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dr_customer ON public.delivery_receipts USING btree (customer_id);


--
-- Name: idx_dr_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dr_date ON public.delivery_receipts USING btree (receipt_date);


--
-- Name: idx_dr_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dr_po ON public.delivery_receipts USING btree (po_id);


--
-- Name: idx_dr_sales; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dr_sales ON public.delivery_receipts USING btree (sales_order_id);


--
-- Name: idx_eh_direction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eh_direction ON public.email_history USING btree (direction, created_at DESC);


--
-- Name: idx_eh_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eh_ref ON public.email_history USING btree (ref_type, ref_id);


--
-- Name: idx_einv_buyer_tax; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_einv_buyer_tax ON public.e_invoices USING btree (buyer_tax_code);


--
-- Name: idx_einv_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_einv_date ON public.e_invoices USING btree (issue_date);


--
-- Name: idx_einv_revenue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_einv_revenue ON public.e_invoices USING btree (revenue_invoice_id);


--
-- Name: idx_einv_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_einv_status ON public.e_invoices USING btree (signing_status);


--
-- Name: idx_el_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_el_created ON public.error_log USING btree (created_at DESC);


--
-- Name: idx_el_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_el_severity ON public.error_log USING btree (severity, created_at DESC);


--
-- Name: idx_el_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_el_type ON public.error_log USING btree (error_type, created_at DESC);


--
-- Name: idx_el_unresolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_el_unresolved ON public.error_log USING btree (resolved) WHERE (resolved = false);


--
-- Name: idx_emp_kpi_dept_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_kpi_dept_period ON public.employee_monthly_kpi USING btree (department, period_key);


--
-- Name: idx_emp_kpi_period_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_kpi_period_key ON public.employee_monthly_kpi USING btree (period_key);


--
-- Name: idx_emp_kpi_revenue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_kpi_revenue ON public.employee_monthly_kpi USING btree (period_key, revenue_vnd DESC);


--
-- Name: idx_emp_kpi_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_kpi_user ON public.employee_monthly_kpi USING btree (user_id);


--
-- Name: idx_er_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_er_date ON public.exchange_rates USING btree (rate_date DESC);


--
-- Name: idx_er_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_er_pair ON public.exchange_rates USING btree (from_currency, to_currency, rate_date DESC);


--
-- Name: idx_etl_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_etl_status ON public.etl_sync_log USING btree (status);


--
-- Name: idx_etl_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_etl_type ON public.etl_sync_log USING btree (sync_type);


--
-- Name: idx_exrate_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exrate_date ON public.exchange_rates USING btree (rate_date DESC);


--
-- Name: idx_exrate_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exrate_lookup ON public.exchange_rates USING btree (from_currency, to_currency, rate_date DESC);


--
-- Name: idx_exrate_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exrate_pair ON public.exchange_rates USING btree (from_currency, to_currency);


--
-- Name: idx_fiscal_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fiscal_status ON public.fiscal_periods USING btree (status);


--
-- Name: idx_fiscal_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fiscal_year ON public.fiscal_periods USING btree (fiscal_year);


--
-- Name: idx_fm_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fm_ref ON public.file_meta USING btree (ref_type, ref_id);


--
-- Name: idx_fm_uploaded_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fm_uploaded_by ON public.file_meta USING btree (uploaded_by);


--
-- Name: idx_frs_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_frs_path ON public.file_review_status USING btree (file_path);


--
-- Name: idx_frs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_frs_status ON public.file_review_status USING btree (status);


--
-- Name: idx_help_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_help_category ON public.help_articles USING btree (category, order_index);


--
-- Name: idx_help_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_help_slug ON public.help_articles USING btree (slug);


--
-- Name: idx_hscode_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hscode_active ON public.hs_codes USING btree (hs_code) WHERE (is_active = true);


--
-- Name: idx_idem_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idem_expires ON public.idempotency_keys USING btree (expires_at);


--
-- Name: idx_ii_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ii_invoice ON public.invoice_items USING btree (invoice_id);


--
-- Name: idx_ii_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ii_product ON public.invoice_items USING btree (product_id) WHERE (product_id IS NOT NULL);


--
-- Name: idx_imv_contract_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_contract_date ON public.imv_contracts USING btree (contract_date DESC);


--
-- Name: idx_imv_del_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_del_customer ON public.imv_deliveries USING btree (customer_name);


--
-- Name: idx_imv_del_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_del_due ON public.imv_deliveries USING btree (due_date);


--
-- Name: idx_imv_del_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_del_item ON public.imv_deliveries USING btree (item_code);


--
-- Name: idx_imv_del_shipped; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_del_shipped ON public.imv_deliveries USING btree (shipped_date DESC);


--
-- Name: idx_imv_del_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_del_status ON public.imv_deliveries USING btree (status);


--
-- Name: idx_imv_inq_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_inq_hash ON public.imv_inquiries USING btree (source_hash) WHERE (source_hash IS NOT NULL);


--
-- Name: idx_imv_orders_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_orders_customer ON public.imv_orders USING btree (customer_name);


--
-- Name: idx_imv_orders_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_orders_due ON public.imv_orders USING btree (delivery_due);


--
-- Name: idx_imv_orders_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_orders_item ON public.imv_orders USING btree (item_code);


--
-- Name: idx_imv_orders_order_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_orders_order_date ON public.imv_orders USING btree (order_date DESC);


--
-- Name: idx_imv_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_orders_status ON public.imv_orders USING btree (status_text);


--
-- Name: idx_imv_pay_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_pay_customer ON public.imv_payments USING btree (customer_name);


--
-- Name: idx_imv_pay_invoice_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_pay_invoice_date ON public.imv_payments USING btree (invoice_date DESC);


--
-- Name: idx_imv_pay_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_pay_invoice_id ON public.imv_payments USING btree (invoice_id);


--
-- Name: idx_imv_rej_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_rej_date ON public.imv_rejections USING btree (rejection_date DESC);


--
-- Name: idx_imv_rfq_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_rfq_customer ON public.imv_rfq USING btree (customer_name);


--
-- Name: idx_imv_rfq_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_rfq_due_date ON public.imv_rfq USING btree (due_date);


--
-- Name: idx_imv_rfq_handler; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_rfq_handler ON public.imv_rfq USING btree (handler_login);


--
-- Name: idx_imv_rfq_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_rfq_item ON public.imv_rfq USING btree (item_code);


--
-- Name: idx_imv_rfq_request_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_rfq_request_date ON public.imv_rfq USING btree (request_date DESC);


--
-- Name: idx_imv_rfq_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_rfq_status ON public.imv_rfq USING btree (flow_status);


--
-- Name: idx_imv_sync_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_sync_log_entity ON public.imv_sync_log USING btree (entity_type, started_at DESC);


--
-- Name: idx_imv_sync_log_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imv_sync_log_started ON public.imv_sync_log USING btree (started_at DESC);


--
-- Name: idx_imvcon_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imvcon_customer ON public.imv_consolidated USING btree (customer_id);


--
-- Name: idx_imvcon_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imvcon_product ON public.imv_consolidated USING btree (product_id);


--
-- Name: idx_imvcon_purchaser; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imvcon_purchaser ON public.imv_consolidated USING btree (purchaser_id);


--
-- Name: idx_imvcon_sales; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imvcon_sales ON public.imv_consolidated USING btree (sales_person_id);


--
-- Name: idx_imviq_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imviq_date ON public.imv_inquiries USING btree (inquiry_date);


--
-- Name: idx_imviq_pic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imviq_pic ON public.imv_inquiries USING btree (person_in_charge);


--
-- Name: idx_imviq_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imviq_product ON public.imv_inquiries USING btree (product_id);


--
-- Name: idx_imviq_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imviq_supplier ON public.imv_inquiries USING btree (supplier_id);


--
-- Name: idx_imvpo_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imvpo_date ON public.imv_purchase_orders USING btree (po_date);


--
-- Name: idx_imvpo_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imvpo_number ON public.imv_purchase_orders USING btree (po_number);


--
-- Name: idx_imvpo_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imvpo_product ON public.imv_purchase_orders USING btree (product_id);


--
-- Name: idx_imvpo_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imvpo_supplier ON public.imv_purchase_orders USING btree (supplier_id);


--
-- Name: idx_inv_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_category ON public.inventory USING btree (category);


--
-- Name: idx_inv_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_chain ON public.invoices USING btree (chain_code) WHERE (chain_code IS NOT NULL);


--
-- Name: idx_inv_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_customer ON public.invoices USING btree (customer_id);


--
-- Name: idx_inv_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_due ON public.invoices USING btree (due_date);


--
-- Name: idx_inv_low_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_low_stock ON public.inventory USING btree (product_code) WHERE ((quantity <= min_stock) AND (min_stock > (0)::numeric));


--
-- Name: idx_inv_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_name_trgm ON public.inventory USING gin (name_unaccent public.gin_trgm_ops);


--
-- Name: idx_inv_overdue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_overdue ON public.invoices USING btree (due_date, status) WHERE (status <> ALL (ARRAY['paid'::text, 'cancelled'::text]));


--
-- Name: idx_inv_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_product ON public.inventory USING btree (product_id);


--
-- Name: idx_inv_so; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_so ON public.invoices USING btree (sales_order_id) WHERE (sales_order_id IS NOT NULL);


--
-- Name: idx_inv_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_status ON public.invoices USING btree (status);


--
-- Name: idx_invmov_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invmov_created ON public.inventory_movements USING btree (created_at);


--
-- Name: idx_invmov_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invmov_product ON public.inventory_movements USING btree (product_id);


--
-- Name: idx_invmov_product_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invmov_product_code ON public.inventory_movements USING btree (product_code);


--
-- Name: idx_invmov_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invmov_ref ON public.inventory_movements USING btree (reference_type, reference_id);


--
-- Name: idx_invmov_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invmov_type ON public.inventory_movements USING btree (movement_type);


--
-- Name: idx_lb_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lb_user ON public.leave_balance USING btree (user_id);


--
-- Name: idx_lr_dept_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lr_dept_status ON public.leave_requests USING btree (department, status);


--
-- Name: idx_lr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lr_status ON public.leave_requests USING btree (status);


--
-- Name: idx_lr_status_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lr_status_open ON public.leave_requests USING btree (status) WHERE (status = 'pending'::text);


--
-- Name: idx_lr_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lr_user ON public.leave_requests USING btree (user_id);


--
-- Name: idx_lr_user_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lr_user_year ON public.leave_requests USING btree (user_id, start_date);


--
-- Name: idx_market_crawled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_crawled ON public.market_prices USING btree (crawled_at DESC);


--
-- Name: idx_market_hs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_hs ON public.market_prices USING btree (hs_code);


--
-- Name: idx_mattype_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mattype_active ON public.material_types USING btree (type_code) WHERE ((is_active = true) AND (deleted_at IS NULL));


--
-- Name: idx_mv_bqms_wr; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_bqms_wr ON public.mv_bqms_win_rate USING btree (month);


--
-- Name: idx_mv_inv_val; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_inv_val ON public.mv_inventory_value USING btree (category);


--
-- Name: idx_mv_rev_monthly; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_rev_monthly ON public.mv_revenue_monthly USING btree (invoice_year, invoice_month, COALESCE(company_id, (0)::bigint));


--
-- Name: idx_mv_sup_perf; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_sup_perf ON public.mv_supplier_performance USING btree (supplier_id);


--
-- Name: idx_mv_vat_decl; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_vat_decl ON public.mv_vat_declaration_monthly USING btree (year, month, COALESCE(company_id, (0)::bigint));


--
-- Name: idx_mvrl_view; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mvrl_view ON public.mv_refresh_log USING btree (view_name);


--
-- Name: idx_notif_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_recipient ON public.notifications USING btree (recipient_id);


--
-- Name: idx_notif_recipient_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_recipient_created ON public.notifications USING btree (recipient_id, created_at DESC);


--
-- Name: idx_notif_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_ref ON public.notifications USING btree (ref_type, ref_id);


--
-- Name: idx_notif_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_type ON public.notifications USING btree (type);


--
-- Name: idx_notif_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_unread ON public.notifications USING btree (recipient_id, created_at DESC) WHERE (is_read = false);


--
-- Name: idx_notif_vendor_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_vendor_unread ON public.notifications USING btree (recipient_vendor_id) WHERE (recipient_vendor_id IS NOT NULL);


--
-- Name: idx_ofi_cache_lru; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ofi_cache_lru ON public.onedrive_file_index USING btree (cached_at) WHERE (is_cached = true);


--
-- Name: idx_ofi_cache_size; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ofi_cache_size ON public.onedrive_file_index USING btree (cache_size DESC) WHERE (is_cached = true);


--
-- Name: idx_ofi_cached; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ofi_cached ON public.onedrive_file_index USING btree (is_cached) WHERE (is_cached = true);


--
-- Name: idx_ofi_extension; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ofi_extension ON public.onedrive_file_index USING btree (file_extension);


--
-- Name: idx_ofi_folder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ofi_folder ON public.onedrive_file_index USING btree (is_folder, graph_parent_id);


--
-- Name: idx_ofi_name_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ofi_name_fts ON public.onedrive_file_index USING gin (to_tsvector('simple'::regconfig, name));


--
-- Name: idx_ofi_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ofi_name_trgm ON public.onedrive_file_index USING gin (name_trgm public.gin_trgm_ops);


--
-- Name: idx_ofi_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ofi_parent ON public.onedrive_file_index USING btree (graph_parent_id);


--
-- Name: idx_ofi_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ofi_path ON public.onedrive_file_index USING btree (file_path);


--
-- Name: idx_ofi_sync_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ofi_sync_status ON public.onedrive_file_index USING btree (sync_status);


--
-- Name: idx_pa_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pa_batch ON public.procurement_awards USING btree (batch_id);


--
-- Name: idx_pa_pending_writeback; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pa_pending_writeback ON public.procurement_awards USING btree (id) WHERE (written_back_to_sourcing = false);


--
-- Name: idx_pa_quote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pa_quote ON public.procurement_awards USING btree (quote_id);


--
-- Name: idx_pa_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pa_vendor ON public.procurement_awards USING btree (vendor_id);


--
-- Name: idx_pal_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pal_entity ON public.procurement_audit_log USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: idx_pbt_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pbt_batch ON public.procurement_bid_tokens USING btree (batch_id);


--
-- Name: idx_pbt_open_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pbt_open_active ON public.procurement_bid_tokens USING btree (batch_id, expires_at) WHERE (revoked_at IS NULL);


--
-- Name: idx_pbt_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pbt_token ON public.procurement_bid_tokens USING btree (token);


--
-- Name: idx_pbt_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pbt_vendor ON public.procurement_bid_tokens USING btree (vendor_id);


--
-- Name: idx_pct_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pct_batch ON public.procurement_contracts USING btree (batch_id);


--
-- Name: idx_pct_signed_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pct_signed_user ON public.procurement_contracts USING btree (signed_by_user);


--
-- Name: idx_pct_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pct_status ON public.procurement_contracts USING btree (status);


--
-- Name: idx_pct_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pct_vendor ON public.procurement_contracts USING btree (vendor_id);


--
-- Name: idx_pdel_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdel_po ON public.procurement_deliveries USING btree (po_id);


--
-- Name: idx_pdel_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdel_status ON public.procurement_deliveries USING btree (status);


--
-- Name: idx_pdli_delivery; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdli_delivery ON public.procurement_delivery_items USING btree (delivery_id);


--
-- Name: idx_pet_exp_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pet_exp_log_created_at ON public.pet_exp_log USING btree (created_at DESC);


--
-- Name: idx_pet_exp_log_pet_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pet_exp_log_pet_id ON public.pet_exp_log USING btree (user_pet_id);


--
-- Name: idx_ph_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ph_product ON public.price_history USING btree (product_code);


--
-- Name: idx_ph_recorded; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ph_recorded ON public.price_history USING btree (recorded_at DESC);


--
-- Name: idx_ph_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ph_supplier ON public.price_history USING btree (supplier_id);


--
-- Name: idx_pipeline_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_customer ON public.crm_pipeline_cards USING btree (customer_name);


--
-- Name: idx_pipeline_followup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_followup ON public.crm_pipeline_cards USING btree (follow_up_date) WHERE ((follow_up_date IS NOT NULL) AND (NOT is_archived));


--
-- Name: idx_pipeline_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_stage ON public.crm_pipeline_cards USING btree (stage) WHERE (NOT is_archived);


--
-- Name: idx_po_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_active ON public.purchase_orders USING btree (status) WHERE (status <> ALL (ARRAY['cancelled'::public.po_status, 'closed'::public.po_status]));


--
-- Name: idx_po_business; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_business ON public.purchase_orders USING btree (business_system);


--
-- Name: idx_po_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_chain ON public.purchase_orders USING btree (chain_code) WHERE (chain_code IS NOT NULL);


--
-- Name: idx_po_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_company ON public.purchase_orders USING btree (company_id);


--
-- Name: idx_po_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_created_by ON public.purchase_orders USING btree (created_by);


--
-- Name: idx_po_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_customer ON public.purchase_orders USING btree (customer_id);


--
-- Name: idx_po_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_date ON public.purchase_orders USING btree (order_date);


--
-- Name: idx_po_so_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_so_id ON public.purchase_orders USING btree (sales_order_id) WHERE (sales_order_id IS NOT NULL);


--
-- Name: idx_po_sourcing_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_sourcing_order ON public.purchase_orders USING btree (sourcing_order_id) WHERE (sourcing_order_id IS NOT NULL);


--
-- Name: idx_po_sq_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_sq_id ON public.purchase_orders USING btree (supplier_quote_id) WHERE (supplier_quote_id IS NOT NULL);


--
-- Name: idx_po_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_status ON public.purchase_orders USING btree (status);


--
-- Name: idx_po_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_supplier ON public.purchase_orders USING btree (supplier_id);


--
-- Name: idx_po_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_workflow ON public.purchase_orders USING btree (workflow_id);


--
-- Name: idx_poli_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poli_po ON public.po_line_items USING btree (po_id);


--
-- Name: idx_poli_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poli_product ON public.po_line_items USING btree (product_id);


--
-- Name: idx_ppo_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_contract ON public.procurement_pos USING btree (contract_id);


--
-- Name: idx_ppo_delivery_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_delivery_due ON public.procurement_pos USING btree (requested_delivery_date) WHERE ((status = ANY (ARRAY['open'::text, 'partially_delivered'::text])) AND (delivery_reminder_sent_at IS NULL));


--
-- Name: idx_ppo_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_status ON public.procurement_pos USING btree (status);


--
-- Name: idx_ppo_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_vendor ON public.procurement_pos USING btree (vendor_id);


--
-- Name: idx_pr_calculated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_calculated ON public.profit_reports USING btree (calculated_at DESC);


--
-- Name: idx_pr_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_period ON public.profit_reports USING btree (period_start, period_end);


--
-- Name: idx_pr_report_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_report_type ON public.profit_reports USING btree (report_type);


--
-- Name: idx_pr_requester; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_requester ON public.payment_requests USING btree (requester_id);


--
-- Name: idx_pr_sourcing_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_sourcing_order ON public.payment_requests USING btree (sourcing_order_id);


--
-- Name: idx_pr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_status ON public.payment_requests USING btree (status);


--
-- Name: idx_pr_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_status_created ON public.payment_requests USING btree (status, created_at DESC);


--
-- Name: idx_pr_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_workflow ON public.payment_requests USING btree (workflow_id);


--
-- Name: idx_prfq_batch_approval_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prfq_batch_approval_pending ON public.procurement_rfq_batches USING btree (status) WHERE (status = ANY (ARRAY['cho_duyet'::text, 'approved'::text]));


--
-- Name: idx_prfq_batch_award_proposed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prfq_batch_award_proposed ON public.procurement_rfq_batches USING btree (award_status) WHERE (award_status = 'proposed'::text);


--
-- Name: idx_prfq_batch_bid_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prfq_batch_bid_deadline ON public.procurement_rfq_batches USING btree (bid_deadline) WHERE (status = 'published'::text);


--
-- Name: idx_prfq_batch_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prfq_batch_status ON public.procurement_rfq_batches USING btree (status);


--
-- Name: idx_prfq_batch_visibility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prfq_batch_visibility ON public.procurement_rfq_batches USING btree (visibility);


--
-- Name: idx_prfq_batches_reg_dt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prfq_batches_reg_dt ON public.procurement_rfq_batches USING btree (reg_dt DESC);


--
-- Name: idx_prfq_inv_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prfq_inv_batch ON public.procurement_rfq_invitations USING btree (batch_id);


--
-- Name: idx_prfq_inv_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prfq_inv_status ON public.procurement_rfq_invitations USING btree (status);


--
-- Name: idx_prfq_inv_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prfq_inv_vendor ON public.procurement_rfq_invitations USING btree (vendor_id);


--
-- Name: idx_prfq_item_item_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prfq_item_item_code ON public.procurement_rfq_items USING btree (item_code);


--
-- Name: idx_prfq_item_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prfq_item_source ON public.procurement_rfq_items USING btree (source_kind, source_ref_id);


--
-- Name: idx_prfq_items_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prfq_items_batch ON public.procurement_rfq_items USING btree (batch_id);


--
-- Name: idx_prfq_shared_files_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prfq_shared_files_batch ON public.procurement_rfq_shared_files USING btree (batch_id);


--
-- Name: idx_prfq_shared_files_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prfq_shared_files_item ON public.procurement_rfq_shared_files USING btree (item_id);


--
-- Name: idx_pricing_rules_history_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_rules_history_item ON public.sourcing_pricing_rules_history USING btree (rule_item_type, changed_at DESC);


--
-- Name: idx_prod_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prod_active ON public.products USING btree (id) WHERE ((is_active = true) AND (deleted_at IS NULL));


--
-- Name: idx_prod_bqms; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prod_bqms ON public.products USING btree (bqms_code) WHERE (bqms_code IS NOT NULL);


--
-- Name: idx_prod_business; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prod_business ON public.products USING btree (business_system);


--
-- Name: idx_prod_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prod_category ON public.products USING btree (category);


--
-- Name: idx_prod_hscode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prod_hscode ON public.products USING btree (hs_code_id);


--
-- Name: idx_prod_imv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prod_imv ON public.products USING btree (imv_code) WHERE (imv_code IS NOT NULL);


--
-- Name: idx_prod_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prod_material ON public.products USING btree (material_type_id);


--
-- Name: idx_prod_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prod_name_trgm ON public.products USING gin (product_name_unaccent public.gin_trgm_ops);


--
-- Name: idx_products_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_created_at ON public.products USING btree (created_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_pt_ap; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pt_ap ON public.payment_transactions USING btree (ap_id);


--
-- Name: idx_pt_ar; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pt_ar ON public.payment_transactions USING btree (ar_id);


--
-- Name: idx_pt_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pt_date ON public.payment_transactions USING btree (payment_date);


--
-- Name: idx_pt_direction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pt_direction ON public.payment_transactions USING btree (direction);


--
-- Name: idx_public_holidays_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_public_holidays_active ON public.public_holidays USING btree (holiday_date) WHERE (is_active = true);


--
-- Name: idx_purchase_inv_q_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_inv_q_date ON public.purchase_invoices_q USING btree (invoice_date);


--
-- Name: idx_purchase_inv_q_quarter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_inv_q_quarter ON public.purchase_invoices_q USING btree (quarter);


--
-- Name: idx_purchase_inv_q_seller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_inv_q_seller ON public.purchase_invoices_q USING btree (seller_name);


--
-- Name: idx_qb_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qb_created ON public.quote_batches USING btree (created_at DESC);


--
-- Name: idx_qb_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qb_customer ON public.quote_batches USING btree (customer_id, created_at DESC) WHERE (customer_id IS NOT NULL);


--
-- Name: idx_qb_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qb_group ON public.quote_batches USING btree (quote_group_id, version_no DESC);


--
-- Name: idx_qb_quote_no_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qb_quote_no_prefix ON public.quote_batches USING btree ("left"(quote_no, 9));


--
-- Name: idx_qlog_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qlog_by ON public.bqms_quote_log USING btree (quoted_by, quoted_at DESC);


--
-- Name: idx_qlog_quoted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qlog_quoted_at ON public.bqms_quote_log USING btree (quoted_at DESC);


--
-- Name: idx_qlog_rfq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qlog_rfq ON public.bqms_quote_log USING btree (rfq_id);


--
-- Name: idx_qlog_round; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qlog_round ON public.bqms_quote_log USING btree (round, quoted_at DESC);


--
-- Name: idx_qt_default; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qt_default ON public.quotation_templates USING btree (is_default) WHERE (is_default = true);


--
-- Name: idx_qt_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qt_type ON public.quotation_templates USING btree (template_type);


--
-- Name: idx_quot_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quot_active ON public.quotations USING btree (created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_quot_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quot_created ON public.quotations USING btree (created_at DESC);


--
-- Name: idx_quot_flow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quot_flow ON public.quotations USING btree (flow_type);


--
-- Name: idx_quot_onedrive_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quot_onedrive_pending ON public.quotations USING btree (id) WHERE ((onedrive_synced_at IS NULL) AND (status = 'completed'::text));


--
-- Name: idx_quot_onedrive_synced; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quot_onedrive_synced ON public.quotations USING btree (onedrive_synced_at) WHERE (onedrive_synced_at IS NOT NULL);


--
-- Name: idx_quot_rfq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quot_rfq ON public.quotations USING btree (rfq_no);


--
-- Name: idx_quot_rfq_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quot_rfq_active ON public.quotations USING btree (rfq_no) WHERE (deleted_at IS NULL);


--
-- Name: idx_quot_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quot_status ON public.quotations USING btree (status);


--
-- Name: idx_quot_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quot_user ON public.quotations USING btree (created_by);


--
-- Name: idx_quote_batch_items_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quote_batch_items_batch ON public.bqms_quote_batch_items USING btree (batch_id);


--
-- Name: idx_quote_batch_items_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quote_batch_items_status ON public.bqms_quote_batch_items USING btree (status);


--
-- Name: idx_quote_batches_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quote_batches_created_at ON public.bqms_quote_batches USING btree (created_at DESC);


--
-- Name: idx_rc_complete; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_complete ON public.revenue_chain USING btree (is_complete);


--
-- Name: idx_rc_completed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_completed_at ON public.revenue_chain USING btree (completed_at) WHERE (is_complete = true);


--
-- Name: idx_rc_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_po ON public.revenue_chain USING btree (po_id) WHERE (po_id IS NOT NULL);


--
-- Name: idx_rc_rfq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_rfq ON public.revenue_chain USING btree (rfq_id) WHERE (rfq_id IS NOT NULL);


--
-- Name: idx_rc_so; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_so ON public.revenue_chain USING btree (sales_order_id) WHERE (sales_order_id IS NOT NULL);


--
-- Name: idx_rc_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_stage ON public.revenue_chain USING btree (current_stage);


--
-- Name: idx_re_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_re_created ON public.report_executions USING btree (created_at DESC);


--
-- Name: idx_re_schedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_re_schedule ON public.report_executions USING btree (schedule_id);


--
-- Name: idx_re_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_re_status ON public.report_executions USING btree (status);


--
-- Name: idx_report_exec_schedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_exec_schedule ON public.report_executions USING btree (schedule_id);


--
-- Name: idx_revinv_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revinv_company ON public.revenue_invoices USING btree (company_id);


--
-- Name: idx_revinv_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revinv_customer ON public.revenue_invoices USING btree (customer_id);


--
-- Name: idx_revinv_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revinv_date ON public.revenue_invoices USING btree (invoice_date);


--
-- Name: idx_revinv_imv_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revinv_imv_po ON public.revenue_invoices USING btree (imv_po_id);


--
-- Name: idx_revinv_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revinv_po ON public.revenue_invoices USING btree (po_id);


--
-- Name: idx_revinv_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revinv_product ON public.revenue_invoices USING btree (product_id);


--
-- Name: idx_revinv_sales; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revinv_sales ON public.revenue_invoices USING btree (sales_order_id);


--
-- Name: idx_revinv_samsung_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revinv_samsung_po ON public.revenue_invoices USING btree (samsung_po_id);


--
-- Name: idx_revinv_yearmonth; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revinv_yearmonth ON public.revenue_invoices USING btree (invoice_year, invoice_month);


--
-- Name: idx_rfq_msg_addendum; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfq_msg_addendum ON public.procurement_rfq_messages USING btree (batch_id, created_at) WHERE (kind = 'addendum'::text);


--
-- Name: idx_rfq_msg_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfq_msg_thread ON public.procurement_rfq_messages USING btree (batch_id, vendor_id, created_at);


--
-- Name: idx_rfqli_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfqli_product ON public.rfq_line_items USING btree (product_id);


--
-- Name: idx_rfqli_rfq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfqli_rfq ON public.rfq_line_items USING btree (rfq_id);


--
-- Name: idx_rfqq_rfq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfqq_rfq ON public.rfq_quotations USING btree (rfq_id);


--
-- Name: idx_rfqq_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfqq_supplier ON public.rfq_quotations USING btree (supplier_id);


--
-- Name: idx_rfqr_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfqr_created_by ON public.rfq_requests USING btree (created_by);


--
-- Name: idx_rfqr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfqr_status ON public.rfq_requests USING btree (status);


--
-- Name: idx_rq_job_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rq_job_type ON public.retry_queue USING btree (job_type, created_at DESC);


--
-- Name: idx_rq_next_retry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rq_next_retry ON public.retry_queue USING btree (next_retry_at) WHERE (status = 'pending'::text);


--
-- Name: idx_rq_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rq_status ON public.retry_queue USING btree (status) WHERE (status = ANY (ARRAY['pending'::text, 'retrying'::text]));


--
-- Name: idx_sa_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sa_active_unique ON public.stock_alerts USING btree (product_id, alert_type) WHERE (status = 'active'::text);


--
-- Name: idx_sa_alert_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sa_alert_type ON public.stock_alerts USING btree (alert_type);


--
-- Name: idx_sa_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sa_created ON public.stock_alerts USING btree (created_at DESC);


--
-- Name: idx_sa_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sa_product_id ON public.stock_alerts USING btree (product_id);


--
-- Name: idx_sa_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sa_status ON public.stock_alerts USING btree (status);


--
-- Name: idx_sales_inv_q_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_inv_q_date ON public.sales_invoices_q USING btree (invoice_date);


--
-- Name: idx_sales_inv_q_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_inv_q_number ON public.sales_invoices_q USING btree (invoice_number);


--
-- Name: idx_sales_inv_q_quarter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_inv_q_quarter ON public.sales_invoices_q USING btree (quarter);


--
-- Name: idx_se_brand_canon; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_se_brand_canon ON public.sourcing_entries USING btree (brand_canonical) WHERE ((deleted_at IS NULL) AND (brand_canonical IS NOT NULL));


--
-- Name: idx_se_catalog_cat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_se_catalog_cat ON public.sourcing_entries USING btree (catalog_category) WHERE ((deleted_at IS NULL) AND (catalog_category IS NOT NULL));


--
-- Name: idx_se_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_se_customer_id ON public.sourcing_entries USING btree (customer_id, inquiry_date DESC NULLS LAST) WHERE ((deleted_at IS NULL) AND (customer_id IS NOT NULL));


--
-- Name: idx_se_model_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_se_model_norm ON public.sourcing_entries USING btree (model_norm) WHERE ((deleted_at IS NULL) AND (model_norm <> ''::text));


--
-- Name: idx_se_model_norm_inq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_se_model_norm_inq ON public.sourcing_entries USING btree (model_norm, inquiry_date DESC NULLS LAST) WHERE ((deleted_at IS NULL) AND (model_norm <> ''::text));


--
-- Name: idx_se_model_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_se_model_trgm ON public.sourcing_entries USING gin (model public.gin_trgm_ops) WHERE (deleted_at IS NULL);


--
-- Name: idx_se_product_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_se_product_name_trgm ON public.sourcing_entries USING gin (product_name public.gin_trgm_ops) WHERE (deleted_at IS NULL);


--
-- Name: idx_se_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_se_recent ON public.sourcing_entries USING btree (inquiry_date DESC NULLS LAST) WHERE (deleted_at IS NULL);


--
-- Name: idx_se_stage_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_se_stage_status ON public.sourcing_entries USING btree (stage, catalog_status) WHERE (deleted_at IS NULL);


--
-- Name: idx_seclog_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seclog_ip ON public.security_log USING btree (ip_address);


--
-- Name: idx_seclog_sev; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seclog_sev ON public.security_log USING btree (severity, created_at DESC);


--
-- Name: idx_seclog_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seclog_type ON public.security_log USING btree (event_type, created_at DESC);


--
-- Name: idx_seclog_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seclog_user ON public.security_log USING btree (user_id);


--
-- Name: idx_sess_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sess_active ON public.user_sessions USING btree (user_id, expires_at) WHERE (is_revoked = false);


--
-- Name: idx_sess_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sess_token ON public.user_sessions USING btree (session_token);


--
-- Name: idx_sess_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sess_user ON public.user_sessions USING btree (user_id);


--
-- Name: idx_sh_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sh_chain ON public.shipments USING btree (chain_code) WHERE (chain_code IS NOT NULL);


--
-- Name: idx_sh_eta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sh_eta ON public.shipments USING btree (eta);


--
-- Name: idx_sh_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sh_po ON public.shipments USING btree (po_id);


--
-- Name: idx_sh_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sh_status ON public.shipments USING btree (status);


--
-- Name: idx_sh_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sh_supplier ON public.shipments USING btree (supplier_id);


--
-- Name: idx_sh_tracking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sh_tracking ON public.shipments USING btree (tracking_number) WHERE (tracking_number IS NOT NULL);


--
-- Name: idx_shc_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shc_created ON public.system_health_checks USING btree (created_at DESC);


--
-- Name: idx_shc_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shc_type ON public.system_health_checks USING btree (check_type, created_at DESC);


--
-- Name: idx_shi_po_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shi_po_line ON public.shipment_items USING btree (po_line_id) WHERE (po_line_id IS NOT NULL);


--
-- Name: idx_shi_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shi_product ON public.shipment_items USING btree (product_id) WHERE (product_id IS NOT NULL);


--
-- Name: idx_shi_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shi_shipment ON public.shipment_items USING btree (shipment_id);


--
-- Name: idx_so_assigned_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_assigned_to ON public.sourcing_orders USING btree (assigned_to) WHERE (deleted_at IS NULL);


--
-- Name: idx_so_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_chain ON public.sales_orders USING btree (chain_code) WHERE (chain_code IS NOT NULL);


--
-- Name: idx_so_chain_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_chain_code ON public.sourcing_orders USING btree (chain_code) WHERE (chain_code IS NOT NULL);


--
-- Name: idx_so_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_company ON public.sales_orders USING btree (company_id);


--
-- Name: idx_so_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_created_at ON public.sourcing_orders USING btree (created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_so_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_created_by ON public.sales_orders USING btree (created_by);


--
-- Name: idx_so_created_by_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_created_by_date ON public.sales_orders USING btree (created_by, created_at);


--
-- Name: idx_so_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_customer ON public.sales_orders USING btree (customer_id);


--
-- Name: idx_so_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_customer_id ON public.sourcing_orders USING btree (customer_id, order_date DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_so_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_date ON public.sales_orders USING btree (order_date);


--
-- Name: idx_so_entry_ids_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_entry_ids_gin ON public.sourcing_orders USING gin (sourcing_entry_ids);


--
-- Name: idx_so_order_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_order_number ON public.sourcing_orders USING btree (order_number);


--
-- Name: idx_so_payment_req; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_payment_req ON public.sourcing_orders USING btree (payment_request_id) WHERE (payment_request_id IS NOT NULL);


--
-- Name: idx_so_rfq_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_rfq_id ON public.sales_orders USING btree (rfq_id) WHERE (rfq_id IS NOT NULL);


--
-- Name: idx_so_samsung_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_samsung_po ON public.sourcing_orders USING btree (samsung_po_number) WHERE (samsung_po_number IS NOT NULL);


--
-- Name: idx_so_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_status ON public.sales_orders USING btree (status);


--
-- Name: idx_soi_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_soi_order ON public.sales_order_items USING btree (sales_order_id);


--
-- Name: idx_soi_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_soi_product ON public.sales_order_items USING btree (product_id);


--
-- Name: idx_sosh_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sosh_order_id ON public.sourcing_order_status_history USING btree (order_id, at DESC);


--
-- Name: idx_sosh_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sosh_status ON public.sourcing_order_status_history USING btree (status);


--
-- Name: idx_sosh_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sosh_user ON public.sourcing_order_status_history USING btree (by_user_id);


--
-- Name: idx_sourcing_bqms_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_bqms_code ON public.sourcing_entries USING btree (bqms_code);


--
-- Name: idx_sourcing_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_created_at ON public.sourcing_entries USING btree (created_at DESC);


--
-- Name: idx_sourcing_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_customer ON public.sourcing_entries USING btree (customer_name);


--
-- Name: idx_sourcing_inquiry_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_inquiry_date ON public.sourcing_entries USING btree (inquiry_date DESC);


--
-- Name: idx_sourcing_maker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_maker ON public.sourcing_entries USING btree (maker);


--
-- Name: idx_sourcing_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_supplier ON public.sourcing_entries USING btree (supplier_name);


--
-- Name: idx_sourcing_updated_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_updated_by ON public.sourcing_entries USING btree (updated_by_id) WHERE (updated_by_id IS NOT NULL);


--
-- Name: idx_spm_bqms; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spm_bqms ON public.supplier_product_map USING btree (bqms_code);


--
-- Name: idx_spm_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spm_created_at ON public.supplier_product_map USING btree (created_at);


--
-- Name: idx_spm_preferred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spm_preferred ON public.supplier_product_map USING btree (bqms_code, is_preferred) WHERE (is_preferred = true);


--
-- Name: idx_spm_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spm_supplier ON public.supplier_product_map USING btree (supplier_id);


--
-- Name: idx_spo_rfq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spo_rfq ON public.bqms_samsung_po USING btree (rfq_id);


--
-- Name: idx_spo_won_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spo_won_by ON public.bqms_samsung_po USING btree (won_by);


--
-- Name: idx_spo_won_by_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spo_won_by_created ON public.bqms_samsung_po USING btree (won_by, created_at) WHERE (won_by IS NOT NULL);


--
-- Name: idx_sps_entry_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sps_entry_version ON public.sourcing_pricing_snapshots USING btree (entry_id, version DESC);


--
-- Name: idx_sq_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sq_chain ON public.supplier_quotes USING btree (chain_code) WHERE (chain_code IS NOT NULL);


--
-- Name: idx_sq_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sq_created ON public.supplier_quotes USING btree (created_at DESC);


--
-- Name: idx_sq_rfq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sq_rfq ON public.supplier_quotes USING btree (rfq_id) WHERE (rfq_id IS NOT NULL);


--
-- Name: idx_sq_so; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sq_so ON public.supplier_quotes USING btree (sales_order_id) WHERE (sales_order_id IS NOT NULL);


--
-- Name: idx_sq_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sq_status ON public.supplier_quotes USING btree (status);


--
-- Name: idx_sq_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sq_supplier ON public.supplier_quotes USING btree (supplier_id);


--
-- Name: idx_sqi_bqms; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sqi_bqms ON public.supplier_quote_items USING btree (bqms_code);


--
-- Name: idx_sqi_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sqi_product ON public.supplier_quote_items USING btree (product_id) WHERE (product_id IS NOT NULL);


--
-- Name: idx_sqi_quote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sqi_quote ON public.supplier_quote_items USING btree (quote_id);


--
-- Name: idx_sr_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sr_active ON public.scheduled_reports USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_sr_next; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sr_next ON public.scheduled_reports USING btree (next_run_at);


--
-- Name: idx_sr_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sr_period ON public.supplier_ratings USING btree (period_year DESC, period_quarter DESC);


--
-- Name: idx_sr_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sr_supplier ON public.supplier_ratings USING btree (supplier_id);


--
-- Name: idx_ssp_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ssp_entry ON public.sourcing_supplier_prices USING btree (sourcing_entry_id);


--
-- Name: idx_ssp_entry_cost; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ssp_entry_cost ON public.sourcing_supplier_prices USING btree (sourcing_entry_id, is_primary DESC, cost_vnd_equiv);


--
-- Name: idx_ssp_one_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ssp_one_primary ON public.sourcing_supplier_prices USING btree (sourcing_entry_id) WHERE (is_primary = true);


--
-- Name: idx_ssp_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ssp_supplier ON public.sourcing_supplier_prices USING btree (supplier_name);


--
-- Name: idx_sup_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sup_name_trgm ON public.suppliers USING gin (name_unaccent public.gin_trgm_ops);


--
-- Name: idx_supcon_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supcon_dates ON public.supplier_contracts USING btree (start_date, end_date);


--
-- Name: idx_supcon_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supcon_status ON public.supplier_contracts USING btree (status);


--
-- Name: idx_supcon_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supcon_supplier ON public.supplier_contracts USING btree (supplier_id);


--
-- Name: idx_supplier_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_active ON public.suppliers USING btree (id) WHERE ((is_active = true) AND (deleted_at IS NULL));


--
-- Name: idx_supplier_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_country ON public.suppliers USING btree (country);


--
-- Name: idx_supplier_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_created_by ON public.suppliers USING btree (created_by);


--
-- Name: idx_supplier_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_name_trgm ON public.suppliers USING gin (name_unaccent public.gin_trgm_ops);


--
-- Name: idx_supplier_rating; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_rating ON public.suppliers USING btree (rating DESC) WHERE (rating IS NOT NULL);


--
-- Name: idx_ta_assigned_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ta_assigned_by ON public.task_assignments USING btree (assigned_by);


--
-- Name: idx_ta_assigned_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ta_assigned_to ON public.task_assignments USING btree (assigned_to);


--
-- Name: idx_ta_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ta_created ON public.task_assignments USING btree (created_at DESC);


--
-- Name: idx_ta_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ta_due_date ON public.task_assignments USING btree (due_date) WHERE (due_date IS NOT NULL);


--
-- Name: idx_ta_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ta_priority ON public.task_assignments USING btree (priority);


--
-- Name: idx_ta_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ta_ref ON public.task_assignments USING btree (ref_type, ref_id) WHERE (ref_type IS NOT NULL);


--
-- Name: idx_ta_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ta_status ON public.task_assignments USING btree (status);


--
-- Name: idx_tagging_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tagging_ref ON public.taggings USING btree (ref_type, ref_id);


--
-- Name: idx_tagging_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tagging_tag ON public.taggings USING btree (tag_id);


--
-- Name: idx_task_assigned_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_assigned_by ON public.tasks USING btree (assigned_by);


--
-- Name: idx_task_assigned_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_assigned_to ON public.tasks USING btree (assigned_to);


--
-- Name: idx_task_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_due ON public.tasks USING btree (due_date) WHERE (status = ANY (ARRAY['todo'::text, 'in_progress'::text]));


--
-- Name: idx_task_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_status ON public.tasks USING btree (status);


--
-- Name: idx_ual_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ual_action ON public.user_activity_log USING btree (action, created_at DESC);


--
-- Name: idx_ual_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ual_page ON public.user_activity_log USING btree (page, created_at DESC);


--
-- Name: idx_ual_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ual_user ON public.user_activity_log USING btree (user_id, created_at DESC);


--
-- Name: idx_user_pets_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_pets_user_id ON public.user_pets USING btree (user_id);


--
-- Name: idx_users_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_active ON public.users USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_users_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_department ON public.users USING btree (department);


--
-- Name: idx_users_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email_lower ON public.users USING btree (lower(email));


--
-- Name: idx_users_m365; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_m365 ON public.users USING btree (m365_id) WHERE (m365_id IS NOT NULL);


--
-- Name: idx_users_not_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_not_deleted ON public.users USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_va_approved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_va_approved ON public.vendor_accounts USING btree (is_approved);


--
-- Name: idx_va_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_va_status ON public.vendor_accounts USING btree (status);


--
-- Name: idx_va_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_va_supplier ON public.vendor_accounts USING btree (supplier_id);


--
-- Name: idx_vn_ship_hist_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vn_ship_hist_entry ON public.sourcing_vn_shipping_history USING btree (entry_id, created_at DESC);


--
-- Name: idx_vq_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vq_batch ON public.vendor_quotes USING btree (batch_id);


--
-- Name: idx_vq_batch_round; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vq_batch_round ON public.vendor_quotes USING btree (batch_id, round_number);


--
-- Name: idx_vq_status_withdrawn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vq_status_withdrawn ON public.vendor_quotes USING btree (batch_id) WHERE (status = 'withdrawn'::text);


--
-- Name: idx_vq_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vq_vendor ON public.vendor_quotes USING btree (vendor_id);


--
-- Name: idx_vqi_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vqi_item ON public.vendor_quote_items USING btree (item_id);


--
-- Name: idx_vqi_quote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vqi_quote ON public.vendor_quote_items USING btree (quote_id);


--
-- Name: idx_watchdog_unprocessed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_watchdog_unprocessed ON public.samsung_watchdog_events USING btree (is_processed, detected_at DESC) WHERE (NOT is_processed);


--
-- Name: idx_wf_assigned_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wf_assigned_to ON public.workflow_instances USING btree (assigned_to);


--
-- Name: idx_wf_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wf_created_by ON public.workflow_instances USING btree (created_by);


--
-- Name: idx_wf_data_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wf_data_gin ON public.workflow_instances USING gin (data);


--
-- Name: idx_wf_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wf_deadline ON public.workflow_instances USING btree (deadline) WHERE (deadline IS NOT NULL);


--
-- Name: idx_wf_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wf_pending ON public.workflow_instances USING btree (assigned_to, current_status) WHERE (current_status = ANY (ARRAY['pending_l1'::public.workflow_status, 'pending_l2'::public.workflow_status]));


--
-- Name: idx_wf_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wf_ref ON public.workflow_instances USING btree (ref_type, ref_id);


--
-- Name: idx_wf_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wf_status ON public.workflow_instances USING btree (current_status);


--
-- Name: idx_wf_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wf_type ON public.workflow_instances USING btree (workflow_type);


--
-- Name: idx_wfh_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wfh_actor ON public.workflow_history USING btree (actor_id);


--
-- Name: idx_wfh_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wfh_created ON public.workflow_history USING btree (created_at);


--
-- Name: idx_wfh_instance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wfh_instance ON public.workflow_history USING btree (instance_id);


--
-- Name: idx_xnk_bqms; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_xnk_bqms ON public.xnk_price_lookup USING btree (bqms_code);


--
-- Name: idx_xnk_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_xnk_company ON public.import_export_tracking USING btree (company_id);


--
-- Name: idx_xnk_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_xnk_date ON public.import_export_tracking USING btree (transaction_date);


--
-- Name: idx_xnk_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_xnk_hash ON public.import_export_tracking USING btree (source_hash) WHERE (source_hash IS NOT NULL);


--
-- Name: idx_xnk_hs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_xnk_hs ON public.xnk_price_lookup USING btree (hs_code);


--
-- Name: idx_xnk_hscode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_xnk_hscode ON public.import_export_tracking USING btree (hs_code_id);


--
-- Name: idx_xnk_item_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_xnk_item_name_trgm ON public.xnk_price_lookup USING gin (item_name public.gin_trgm_ops);


--
-- Name: idx_xnk_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_xnk_product ON public.import_export_tracking USING btree (product_id);


--
-- Name: idx_xnk_rfq_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_xnk_rfq_date ON public.xnk_price_lookup USING btree (rfq_date);


--
-- Name: idx_xnk_seller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_xnk_seller ON public.xnk_price_lookup USING btree (seller_name);


--
-- Name: idx_xnk_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_xnk_year ON public.import_export_tracking USING btree (year);


--
-- Name: ix_vq_rank_hint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_vq_rank_hint ON public.vendor_quotes USING btree (batch_id, round_number, currency, total_amount) WHERE ((status = 'submitted'::text) AND (total_amount > (0)::numeric));


--
-- Name: pim_enrich_audit_entry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pim_enrich_audit_entry_idx ON public.pim_enrichment_audit USING btree (entry_id);


--
-- Name: pim_enrich_audit_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pim_enrich_audit_run_idx ON public.pim_enrichment_audit USING btree (run_id);


--
-- Name: procrastinate_events_job_id_fkey; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX procrastinate_events_job_id_fkey ON public.procrastinate_events USING btree (job_id);


--
-- Name: procrastinate_jobs_id_lock_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX procrastinate_jobs_id_lock_idx ON public.procrastinate_jobs USING btree (id, lock) WHERE (status = ANY (ARRAY['todo'::public.procrastinate_job_status, 'doing'::public.procrastinate_job_status]));


--
-- Name: procrastinate_jobs_lock_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX procrastinate_jobs_lock_idx ON public.procrastinate_jobs USING btree (lock) WHERE (status = 'doing'::public.procrastinate_job_status);


--
-- Name: procrastinate_jobs_queue_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX procrastinate_jobs_queue_name_idx ON public.procrastinate_jobs USING btree (queue_name);


--
-- Name: procrastinate_jobs_queueing_lock_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX procrastinate_jobs_queueing_lock_idx ON public.procrastinate_jobs USING btree (queueing_lock) WHERE (status = 'todo'::public.procrastinate_job_status);


--
-- Name: procrastinate_periodic_defers_job_id_fkey; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX procrastinate_periodic_defers_job_id_fkey ON public.procrastinate_periodic_defers USING btree (job_id);


--
-- Name: uq_ap_procurement_delivery; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ap_procurement_delivery ON public.accounts_payable USING btree (delivery_id) WHERE (delivery_id IS NOT NULL);


--
-- Name: uq_ar_sourcing_order; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ar_sourcing_order ON public.accounts_receivable USING btree (sourcing_order_id) WHERE (sourcing_order_id IS NOT NULL);


--
-- Name: uq_bqms_del_po_ship_bqms; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bqms_del_po_ship_bqms ON public.bqms_deliveries USING btree (po_number, shipping_no, bqms_code);


--
-- Name: uq_bqms_deliv_po_ship_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bqms_deliv_po_ship_code ON public.bqms_deliveries USING btree (po_number, shipping_no, bqms_code) WHERE (po_number IS NOT NULL);


--
-- Name: uq_bqms_mp_rfq_bqms; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bqms_mp_rfq_bqms ON public.bqms_material_pricing USING btree (rfq_number, bqms_code);


--
-- Name: uq_bqms_ord_rfq_bqms; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bqms_ord_rfq_bqms ON public.bqms_orders USING btree (rfq_number, bqms_code);


--
-- Name: uq_bqms_orders_rfq_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bqms_orders_rfq_code ON public.bqms_orders USING btree (rfq_number, bqms_code) WHERE (rfq_number IS NOT NULL);


--
-- Name: uq_bqms_pricing_rfq_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bqms_pricing_rfq_code ON public.bqms_material_pricing USING btree (rfq_number, bqms_code) WHERE (rfq_number IS NOT NULL);


--
-- Name: uq_bqms_rawpo_po_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bqms_rawpo_po_code ON public.bqms_raw_material_po USING btree (po_number, bqms_code) WHERE (po_number IS NOT NULL);


--
-- Name: uq_bqms_rfq_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bqms_rfq_dedup ON public.bqms_rfq USING btree (rfq_number, bqms_code, source_hash);


--
-- Name: uq_bqms_rmp_po_bqms; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bqms_rmp_po_bqms ON public.bqms_raw_material_po USING btree (po_number, bqms_code);


--
-- Name: uq_bqms_won_rfq_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bqms_won_rfq_code ON public.bqms_won_quotations USING btree (rfq_number, bqms_code) WHERE (rfq_number IS NOT NULL);


--
-- Name: uq_bwq_rfq_bqms; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bwq_rfq_bqms ON public.bqms_won_quotations USING btree (rfq_number, bqms_code);


--
-- Name: uq_contacts_name_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_contacts_name_phone ON public.customer_contacts USING btree (full_name, phone) WHERE ((full_name IS NOT NULL) AND (phone IS NOT NULL));


--
-- Name: uq_custcontact_name_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_custcontact_name_phone ON public.customer_contacts USING btree (full_name, phone);


--
-- Name: uq_exchange_rate_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_exchange_rate_date ON public.exchange_rates USING btree (rate_date, from_currency, to_currency);


--
-- Name: uq_fiscal_month; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fiscal_month ON public.fiscal_periods USING btree (fiscal_year, fiscal_month) WHERE (period_type = 'month'::text);


--
-- Name: uq_imv_cons_qt_prod; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_imv_cons_qt_prod ON public.imv_consolidated USING btree (quotation_no, product_code) WHERE (quotation_no IS NOT NULL);


--
-- Name: uq_imv_inq_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_imv_inq_hash ON public.imv_inquiries USING btree (source_hash) WHERE (source_hash IS NOT NULL);


--
-- Name: uq_imvcon_quot_prod; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_imvcon_quot_prod ON public.imv_consolidated USING btree (quotation_no, product_code);


--
-- Name: uq_imviq_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_imviq_hash ON public.imv_inquiries USING btree (source_hash);


--
-- Name: uq_imvpo_po_prod; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_imvpo_po_prod ON public.imv_purchase_orders USING btree (po_number, product_code);


--
-- Name: uq_inventory_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_inventory_product_id ON public.inventory USING btree (product_id);


--
-- Name: INDEX uq_inventory_product_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_inventory_product_id IS 'Mot dong ton kho / san pham — bao dam ON CONFLICT(product_id) upsert an toan.';


--
-- Name: uq_leave_policy_role_dept; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_leave_policy_role_dept ON public.leave_policy USING btree (role, department) NULLS NOT DISTINCT;


--
-- Name: uq_pa_batch_item_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pa_batch_item_active ON public.procurement_awards USING btree (batch_id, item_id) WHERE ((item_id IS NOT NULL) AND (superseded_by IS NULL));


--
-- Name: uq_pa_batch_perbatch_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pa_batch_perbatch_active ON public.procurement_awards USING btree (batch_id) WHERE ((item_id IS NULL) AND (superseded_by IS NULL));


--
-- Name: uq_prfq_inv_batch_vendor_round; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_prfq_inv_batch_vendor_round ON public.procurement_rfq_invitations USING btree (batch_id, vendor_id, round_number);


--
-- Name: uq_rev_inv_num_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_rev_inv_num_date ON public.revenue_invoices USING btree (invoice_number, invoice_date) WHERE (invoice_number IS NOT NULL);


--
-- Name: uq_revinv_num_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_revinv_num_date ON public.revenue_invoices USING btree (invoice_number, invoice_date);


--
-- Name: uq_user_pets_avatar; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_pets_avatar ON public.user_pets USING btree (user_id) WHERE (is_avatar = true);


--
-- Name: uq_va_activation_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_va_activation_token ON public.vendor_accounts USING btree (activation_token) WHERE (activation_token IS NOT NULL);


--
-- Name: uq_va_reset_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_va_reset_token ON public.vendor_accounts USING btree (reset_token) WHERE (reset_token IS NOT NULL);


--
-- Name: uq_vq_batch_vendor_round; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_vq_batch_vendor_round ON public.vendor_quotes USING btree (batch_id, vendor_id, round_number);


--
-- Name: uq_xnk_rfq_bqms_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_xnk_rfq_bqms_date ON public.import_export_tracking USING btree (rfq_number, bqms_code, tracking_date);


--
-- Name: uq_xnk_rfq_code_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_xnk_rfq_code_date ON public.import_export_tracking USING btree (rfq_number, bqms_code, tracking_date) WHERE (rfq_number IS NOT NULL);


--
-- Name: procrastinate_jobs procrastinate_jobs_notify_queue; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER procrastinate_jobs_notify_queue AFTER INSERT ON public.procrastinate_jobs FOR EACH ROW WHEN ((new.status = 'todo'::public.procrastinate_job_status)) EXECUTE FUNCTION public.procrastinate_notify_queue();


--
-- Name: procrastinate_jobs procrastinate_trigger_delete_jobs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER procrastinate_trigger_delete_jobs BEFORE DELETE ON public.procrastinate_jobs FOR EACH ROW EXECUTE FUNCTION public.procrastinate_unlink_periodic_defers();


--
-- Name: procrastinate_jobs procrastinate_trigger_scheduled_events; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER procrastinate_trigger_scheduled_events AFTER INSERT OR UPDATE ON public.procrastinate_jobs FOR EACH ROW WHEN (((new.scheduled_at IS NOT NULL) AND (new.status = 'todo'::public.procrastinate_job_status))) EXECUTE FUNCTION public.procrastinate_trigger_scheduled_events_procedure();


--
-- Name: procrastinate_jobs procrastinate_trigger_status_events_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER procrastinate_trigger_status_events_insert AFTER INSERT ON public.procrastinate_jobs FOR EACH ROW WHEN ((new.status = 'todo'::public.procrastinate_job_status)) EXECUTE FUNCTION public.procrastinate_trigger_status_events_procedure_insert();


--
-- Name: procrastinate_jobs procrastinate_trigger_status_events_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER procrastinate_trigger_status_events_update AFTER UPDATE OF status ON public.procrastinate_jobs FOR EACH ROW EXECUTE FUNCTION public.procrastinate_trigger_status_events_procedure_update();


--
-- Name: accounts_payable trg_accounts_payable_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accounts_payable_updated_at BEFORE UPDATE ON public.accounts_payable FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: accounts_receivable trg_accounts_receivable_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accounts_receivable_updated_at BEFORE UPDATE ON public.accounts_receivable FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: attendance_incidents trg_ai_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ai_updated_at BEFORE UPDATE ON public.attendance_incidents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: accounts_payable trg_audit_accounts_payable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_accounts_payable AFTER INSERT OR DELETE OR UPDATE ON public.accounts_payable FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();


--
-- Name: accounts_receivable trg_audit_accounts_receivable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_accounts_receivable AFTER INSERT OR DELETE OR UPDATE ON public.accounts_receivable FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();


--
-- Name: bqms_samsung_po trg_audit_bqms_samsung_po; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_bqms_samsung_po AFTER INSERT OR DELETE OR UPDATE ON public.bqms_samsung_po FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();


--
-- Name: cash_book trg_audit_cash_book; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_cash_book AFTER INSERT OR DELETE OR UPDATE ON public.cash_book FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();


--
-- Name: customers trg_audit_customers; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_customers AFTER INSERT OR DELETE OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();


--
-- Name: exchange_rates trg_audit_exchange_rates; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_exchange_rates AFTER INSERT OR DELETE OR UPDATE ON public.exchange_rates FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();


--
-- Name: import_export_tracking trg_audit_import_export_tracking; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_import_export_tracking AFTER INSERT OR DELETE OR UPDATE ON public.import_export_tracking FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();


--
-- Name: imv_purchase_orders trg_audit_imv_purchase_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_imv_purchase_orders AFTER INSERT OR DELETE OR UPDATE ON public.imv_purchase_orders FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();


--
-- Name: inventory trg_audit_inventory; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_inventory AFTER INSERT OR DELETE OR UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();


--
-- Name: audit_log trg_audit_log_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_log_immutable BEFORE DELETE OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();


--
-- Name: purchase_orders trg_audit_purchase_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_purchase_orders AFTER INSERT OR DELETE OR UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();


--
-- Name: revenue_invoices trg_audit_revenue_invoices; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_revenue_invoices AFTER INSERT OR DELETE OR UPDATE ON public.revenue_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();


--
-- Name: sales_orders trg_audit_sales_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_sales_orders AFTER INSERT OR DELETE OR UPDATE ON public.sales_orders FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();


--
-- Name: suppliers trg_audit_suppliers; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_suppliers AFTER INSERT OR DELETE OR UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();


--
-- Name: workflow_instances trg_audit_workflow_instances; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_workflow_instances AFTER INSERT OR DELETE OR UPDATE ON public.workflow_instances FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();


--
-- Name: bqms_deliveries trg_bqms_deliveries_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bqms_deliveries_updated_at BEFORE UPDATE ON public.bqms_deliveries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: bqms_manufacturing_schedule trg_bqms_manufacturing_schedule_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bqms_manufacturing_schedule_updated_at BEFORE UPDATE ON public.bqms_manufacturing_schedule FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: bqms_orders trg_bqms_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bqms_orders_updated_at BEFORE UPDATE ON public.bqms_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: bqms_quotation_items trg_bqms_quotation_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bqms_quotation_items_updated_at BEFORE UPDATE ON public.bqms_quotation_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: bqms_raw_material_po trg_bqms_raw_material_po_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bqms_raw_material_po_updated_at BEFORE UPDATE ON public.bqms_raw_material_po FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: bqms_rfq_submissions trg_bqms_rfq_submissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bqms_rfq_submissions_updated_at BEFORE UPDATE ON public.bqms_rfq_submissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: bqms_rfq trg_bqms_rfq_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bqms_rfq_updated_at BEFORE UPDATE ON public.bqms_rfq FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: bqms_samsung_po trg_bqms_samsung_po_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bqms_samsung_po_updated_at BEFORE UPDATE ON public.bqms_samsung_po FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: budget_targets trg_budget_targets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_budget_targets_updated_at BEFORE UPDATE ON public.budget_targets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: bqms_deliveries trg_bump_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_version BEFORE UPDATE ON public.bqms_deliveries FOR EACH ROW EXECUTE FUNCTION public.bump_version_on_update();


--
-- Name: crm_pipeline_cards trg_bump_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_version BEFORE UPDATE ON public.crm_pipeline_cards FOR EACH ROW EXECUTE FUNCTION public.bump_version_on_update();


--
-- Name: customers trg_bump_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_version BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.bump_version_on_update();


--
-- Name: purchase_invoices_q trg_bump_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_version BEFORE UPDATE ON public.purchase_invoices_q FOR EACH ROW EXECUTE FUNCTION public.bump_version_on_update();


--
-- Name: sales_invoices_q trg_bump_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_version BEFORE UPDATE ON public.sales_invoices_q FOR EACH ROW EXECUTE FUNCTION public.bump_version_on_update();


--
-- Name: vendor_quotes trg_bump_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_version BEFORE UPDATE ON public.vendor_quotes FOR EACH ROW EXECUTE FUNCTION public.bump_version_on_update();


--
-- Name: cash_book trg_cash_book_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cash_book_updated_at BEFORE UPDATE ON public.cash_book FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: customer_contacts trg_customer_contacts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customer_contacts_updated_at BEFORE UPDATE ON public.customer_contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: customers trg_customers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: customs_declarations trg_customs_declarations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customs_declarations_updated_at BEFORE UPDATE ON public.customs_declarations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: delivery_receipts trg_delivery_receipts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_delivery_receipts_updated_at BEFORE UPDATE ON public.delivery_receipts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: bqms_dossier_jobs trg_dossier_attempt_no; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dossier_attempt_no BEFORE INSERT ON public.bqms_dossier_jobs FOR EACH ROW EXECUTE FUNCTION public.set_dossier_attempt_no();


--
-- Name: bqms_dossier_jobs trg_dossier_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dossier_jobs_updated_at BEFORE UPDATE ON public.bqms_dossier_jobs FOR EACH ROW EXECUTE FUNCTION public.fn_dossier_jobs_touch_updated_at();


--
-- Name: e_invoices trg_e_invoices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_e_invoices_updated_at BEFORE UPDATE ON public.e_invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: shipments trg_gen_shipment_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gen_shipment_number BEFORE INSERT ON public.shipments FOR EACH ROW WHEN (((new.shipment_number IS NULL) OR (new.shipment_number = ''::text))) EXECUTE FUNCTION public.gen_shipment_number();


--
-- Name: supplier_quotes trg_gen_sq_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gen_sq_number BEFORE INSERT ON public.supplier_quotes FOR EACH ROW WHEN (((new.quote_number IS NULL) OR (new.quote_number = ''::text))) EXECUTE FUNCTION public.gen_supplier_quote_number();


--
-- Name: hs_codes trg_hs_codes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_hs_codes_updated_at BEFORE UPDATE ON public.hs_codes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: import_export_tracking trg_import_export_tracking_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_import_export_tracking_updated_at BEFORE UPDATE ON public.import_export_tracking FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: imv_consolidated trg_imv_consolidated_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_imv_consolidated_updated_at BEFORE UPDATE ON public.imv_consolidated FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: imv_inquiries trg_imv_inquiries_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_imv_inquiries_updated_at BEFORE UPDATE ON public.imv_inquiries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: imv_purchase_orders trg_imv_purchase_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_imv_purchase_orders_updated_at BEFORE UPDATE ON public.imv_purchase_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: leave_balance trg_lb_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lb_updated_at BEFORE UPDATE ON public.leave_balance FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: leave_policy trg_lp_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lp_updated_at BEFORE UPDATE ON public.leave_policy FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: leave_requests trg_lr_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lr_updated_at BEFORE UPDATE ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: material_types trg_material_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_material_types_updated_at BEFORE UPDATE ON public.material_types FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: payment_requests trg_payment_requests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_requests_updated_at BEFORE UPDATE ON public.payment_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: purchase_orders trg_po_generate_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_po_generate_number BEFORE INSERT ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.generate_po_number();


--
-- Name: po_line_items trg_po_line_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_po_line_items_updated_at BEFORE UPDATE ON public.po_line_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: payment_requests trg_pr_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pr_updated_at BEFORE UPDATE ON public.payment_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_payment_requests();


--
-- Name: procurement_audit_log trg_procurement_audit_log_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_procurement_audit_log_immutable BEFORE DELETE OR UPDATE ON public.procurement_audit_log FOR EACH ROW EXECUTE FUNCTION public.procurement_audit_log_immutable();


--
-- Name: products trg_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: purchase_orders trg_purchase_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_purchase_orders_updated_at BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: bqms_quote_batch_items trg_recount_quote_batch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recount_quote_batch AFTER INSERT OR DELETE OR UPDATE OF status ON public.bqms_quote_batch_items FOR EACH ROW EXECUTE FUNCTION public.fn_recount_quote_batch();


--
-- Name: revenue_invoices trg_revenue_invoices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_revenue_invoices_updated_at BEFORE UPDATE ON public.revenue_invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: rfq_requests trg_rfq_requests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rfq_requests_updated_at BEFORE UPDATE ON public.rfq_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: sales_orders trg_sales_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sales_orders_updated_at BEFORE UPDATE ON public.sales_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: sourcing_orders trg_so_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_so_updated_at BEFORE UPDATE ON public.sourcing_orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_sourcing_orders();


--
-- Name: sourcing_entries trg_sourcing_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sourcing_updated_at BEFORE UPDATE ON public.sourcing_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_sourcing();


--
-- Name: sourcing_pricing_rules trg_spr_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_spr_updated_at BEFORE UPDATE ON public.sourcing_pricing_rules FOR EACH ROW EXECUTE FUNCTION public.tg_spr_set_updated_at();


--
-- Name: sourcing_supplier_prices trg_ssp_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ssp_updated_at BEFORE UPDATE ON public.sourcing_supplier_prices FOR EACH ROW EXECUTE FUNCTION public.tg_ssp_set_updated_at();


--
-- Name: supplier_contracts trg_supplier_contracts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_supplier_contracts_updated_at BEFORE UPDATE ON public.supplier_contracts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: suppliers trg_suppliers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: system_settings trg_system_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_system_settings_updated_at BEFORE UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: task_assignments trg_task_assignments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_task_assignments_updated_at BEFORE UPDATE ON public.task_assignments FOR EACH ROW EXECUTE FUNCTION public.update_task_assignments_updated_at();


--
-- Name: tasks trg_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: workflow_instances trg_workflow_instances_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workflow_instances_updated_at BEFORE UPDATE ON public.workflow_instances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: workflow_instances trg_workflow_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workflow_notify AFTER UPDATE ON public.workflow_instances FOR EACH ROW EXECUTE FUNCTION public.notify_workflow_change();


--
-- Name: accounts_payable accounts_payable_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_payable
    ADD CONSTRAINT accounts_payable_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: accounts_payable accounts_payable_delivery_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_payable
    ADD CONSTRAINT accounts_payable_delivery_id_fkey FOREIGN KEY (delivery_id) REFERENCES public.procurement_deliveries(id);


--
-- Name: accounts_payable accounts_payable_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_payable
    ADD CONSTRAINT accounts_payable_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id);


--
-- Name: accounts_payable accounts_payable_procurement_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_payable
    ADD CONSTRAINT accounts_payable_procurement_po_id_fkey FOREIGN KEY (procurement_po_id) REFERENCES public.procurement_pos(id);


--
-- Name: accounts_payable accounts_payable_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_payable
    ADD CONSTRAINT accounts_payable_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: accounts_payable accounts_payable_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_payable
    ADD CONSTRAINT accounts_payable_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendor_accounts(id);


--
-- Name: accounts_receivable accounts_receivable_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_receivable
    ADD CONSTRAINT accounts_receivable_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: accounts_receivable accounts_receivable_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_receivable
    ADD CONSTRAINT accounts_receivable_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: accounts_receivable accounts_receivable_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_receivable
    ADD CONSTRAINT accounts_receivable_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.revenue_invoices(id);


--
-- Name: accounts_receivable accounts_receivable_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_receivable
    ADD CONSTRAINT accounts_receivable_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id);


--
-- Name: ai_classification_results ai_classification_results_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_classification_results
    ADD CONSTRAINT ai_classification_results_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: ai_classification_results ai_classification_results_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_classification_results
    ADD CONSTRAINT ai_classification_results_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.bqms_rfq(id);


--
-- Name: attendance_incidents attendance_incidents_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_incidents
    ADD CONSTRAINT attendance_incidents_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.users(id);


--
-- Name: attendance_incidents attendance_incidents_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_incidents
    ADD CONSTRAINT attendance_incidents_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: attendance_incidents attendance_incidents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_incidents
    ADD CONSTRAINT attendance_incidents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: bqms_contract_items bqms_contract_items_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_contract_items
    ADD CONSTRAINT bqms_contract_items_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.bqms_contracts(id) ON DELETE CASCADE;


--
-- Name: bqms_contracts bqms_contracts_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_contracts
    ADD CONSTRAINT bqms_contracts_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.bqms_rfq(id);


--
-- Name: bqms_contracts bqms_contracts_won_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_contracts
    ADD CONSTRAINT bqms_contracts_won_quotation_id_fkey FOREIGN KEY (won_quotation_id) REFERENCES public.bqms_won_quotations(id);


--
-- Name: bqms_deliveries bqms_deliveries_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_deliveries
    ADD CONSTRAINT bqms_deliveries_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.bqms_contacts(id) ON DELETE SET NULL;


--
-- Name: bqms_deliveries bqms_deliveries_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_deliveries
    ADD CONSTRAINT bqms_deliveries_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: bqms_deliveries bqms_deliveries_samsung_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_deliveries
    ADD CONSTRAINT bqms_deliveries_samsung_po_id_fkey FOREIGN KEY (samsung_po_id) REFERENCES public.bqms_samsung_po(id);


--
-- Name: bqms_dossier_jobs bqms_dossier_jobs_previous_dossier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_dossier_jobs
    ADD CONSTRAINT bqms_dossier_jobs_previous_dossier_id_fkey FOREIGN KEY (previous_dossier_id) REFERENCES public.bqms_dossier_jobs(id) ON DELETE SET NULL;


--
-- Name: bqms_dossier_jobs bqms_dossier_jobs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_dossier_jobs
    ADD CONSTRAINT bqms_dossier_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: bqms_manufacturing_daily bqms_manufacturing_daily_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_manufacturing_daily
    ADD CONSTRAINT bqms_manufacturing_daily_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.bqms_manufacturing_schedule(id) ON DELETE CASCADE;


--
-- Name: bqms_manufacturing_schedule bqms_manufacturing_schedule_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_manufacturing_schedule
    ADD CONSTRAINT bqms_manufacturing_schedule_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: bqms_material_pricing bqms_material_pricing_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_material_pricing
    ADD CONSTRAINT bqms_material_pricing_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: bqms_orders bqms_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_orders
    ADD CONSTRAINT bqms_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: bqms_orders bqms_orders_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_orders
    ADD CONSTRAINT bqms_orders_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: bqms_orders bqms_orders_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_orders
    ADD CONSTRAINT bqms_orders_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.bqms_rfq(id);


--
-- Name: bqms_quotation_items bqms_quotation_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_quotation_items
    ADD CONSTRAINT bqms_quotation_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: bqms_quotation_items bqms_quotation_items_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_quotation_items
    ADD CONSTRAINT bqms_quotation_items_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.bqms_rfq_submissions(id) ON DELETE CASCADE;


--
-- Name: bqms_quote_batch_items bqms_quote_batch_items_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_quote_batch_items
    ADD CONSTRAINT bqms_quote_batch_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.bqms_quote_batches(id) ON DELETE CASCADE;


--
-- Name: bqms_quote_batches bqms_quote_batches_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_quote_batches
    ADD CONSTRAINT bqms_quote_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: bqms_quote_log bqms_quote_log_quoted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_quote_log
    ADD CONSTRAINT bqms_quote_log_quoted_by_fkey FOREIGN KEY (quoted_by) REFERENCES public.users(id);


--
-- Name: bqms_quote_log bqms_quote_log_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_quote_log
    ADD CONSTRAINT bqms_quote_log_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.bqms_rfq(id) ON DELETE CASCADE;


--
-- Name: bqms_raw_material_po bqms_raw_material_po_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_raw_material_po
    ADD CONSTRAINT bqms_raw_material_po_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: bqms_records bqms_records_rfq_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_records
    ADD CONSTRAINT bqms_records_rfq_submission_id_fkey FOREIGN KEY (rfq_submission_id) REFERENCES public.bqms_rfq_submissions(id);


--
-- Name: bqms_records bqms_records_samsung_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_records
    ADD CONSTRAINT bqms_records_samsung_po_id_fkey FOREIGN KEY (samsung_po_id) REFERENCES public.bqms_samsung_po(id);


--
-- Name: bqms_rfq bqms_rfq_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_rfq
    ADD CONSTRAINT bqms_rfq_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: bqms_rfq bqms_rfq_person_in_charge_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_rfq
    ADD CONSTRAINT bqms_rfq_person_in_charge_fkey FOREIGN KEY (person_in_charge) REFERENCES public.users(id);


--
-- Name: bqms_rfq bqms_rfq_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_rfq
    ADD CONSTRAINT bqms_rfq_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: bqms_rfq bqms_rfq_result_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_rfq
    ADD CONSTRAINT bqms_rfq_result_updated_by_fkey FOREIGN KEY (result_updated_by) REFERENCES public.users(id);


--
-- Name: bqms_rfq bqms_rfq_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_rfq
    ADD CONSTRAINT bqms_rfq_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id) ON DELETE SET NULL;


--
-- Name: bqms_rfq_submissions bqms_rfq_submissions_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_rfq_submissions
    ADD CONSTRAINT bqms_rfq_submissions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: bqms_rfq_submissions bqms_rfq_submissions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_rfq_submissions
    ADD CONSTRAINT bqms_rfq_submissions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: bqms_rfq_submissions bqms_rfq_submissions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_rfq_submissions
    ADD CONSTRAINT bqms_rfq_submissions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: bqms_rfq_submissions bqms_rfq_submissions_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_rfq_submissions
    ADD CONSTRAINT bqms_rfq_submissions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id);


--
-- Name: bqms_rfq_submissions bqms_rfq_submissions_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_rfq_submissions
    ADD CONSTRAINT bqms_rfq_submissions_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflow_instances(id);


--
-- Name: bqms_rfq bqms_rfq_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_rfq
    ADD CONSTRAINT bqms_rfq_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: bqms_samsung_po bqms_samsung_po_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_samsung_po
    ADD CONSTRAINT bqms_samsung_po_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: bqms_samsung_po bqms_samsung_po_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_samsung_po
    ADD CONSTRAINT bqms_samsung_po_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.bqms_rfq(id);


--
-- Name: bqms_samsung_po bqms_samsung_po_won_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_samsung_po
    ADD CONSTRAINT bqms_samsung_po_won_by_fkey FOREIGN KEY (won_by) REFERENCES public.users(id);


--
-- Name: bqms_won_quotations bqms_won_quotations_hs_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_won_quotations
    ADD CONSTRAINT bqms_won_quotations_hs_code_id_fkey FOREIGN KEY (hs_code_id) REFERENCES public.hs_codes(id);


--
-- Name: bqms_won_quotations bqms_won_quotations_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_won_quotations
    ADD CONSTRAINT bqms_won_quotations_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: bqms_won_quotations bqms_won_quotations_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bqms_won_quotations
    ADD CONSTRAINT bqms_won_quotations_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.bqms_rfq(id);


--
-- Name: budget_targets budget_targets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_targets
    ADD CONSTRAINT budget_targets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: budget_targets budget_targets_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_targets
    ADD CONSTRAINT budget_targets_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: calendar_events calendar_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: cash_book_categories cash_book_categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_book_categories
    ADD CONSTRAINT cash_book_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.cash_book_categories(id);


--
-- Name: cash_book cash_book_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_book
    ADD CONSTRAINT cash_book_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.cash_book_categories(id);


--
-- Name: cash_book cash_book_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_book
    ADD CONSTRAINT cash_book_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: cash_book cash_book_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_book
    ADD CONSTRAINT cash_book_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: contract_price_items contract_price_items_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_price_items
    ADD CONSTRAINT contract_price_items_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.supplier_contracts(id) ON DELETE CASCADE;


--
-- Name: contract_price_items contract_price_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_price_items
    ADD CONSTRAINT contract_price_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: crm_account_external_map crm_account_external_map_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_account_external_map
    ADD CONSTRAINT crm_account_external_map_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: crm_contacts crm_contacts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: crm_interactions crm_interactions_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_interactions
    ADD CONSTRAINT crm_interactions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id);


--
-- Name: crm_interactions crm_interactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_interactions
    ADD CONSTRAINT crm_interactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: crm_interactions crm_interactions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_interactions
    ADD CONSTRAINT crm_interactions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: crm_pipeline_cards crm_pipeline_cards_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_pipeline_cards
    ADD CONSTRAINT crm_pipeline_cards_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: customer_contacts customer_contacts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_contacts
    ADD CONSTRAINT customer_contacts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: customers customers_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: customs_declaration_items customs_declaration_items_declaration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_declaration_items
    ADD CONSTRAINT customs_declaration_items_declaration_id_fkey FOREIGN KEY (declaration_id) REFERENCES public.customs_declarations(id) ON DELETE CASCADE;


--
-- Name: customs_declaration_items customs_declaration_items_hs_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_declaration_items
    ADD CONSTRAINT customs_declaration_items_hs_code_id_fkey FOREIGN KEY (hs_code_id) REFERENCES public.hs_codes(id);


--
-- Name: customs_declaration_items customs_declaration_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_declaration_items
    ADD CONSTRAINT customs_declaration_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: customs_declaration_items customs_declaration_items_xnk_tracking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_declaration_items
    ADD CONSTRAINT customs_declaration_items_xnk_tracking_id_fkey FOREIGN KEY (xnk_tracking_id) REFERENCES public.import_export_tracking(id);


--
-- Name: customs_declarations customs_declarations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customs_declarations
    ADD CONSTRAINT customs_declarations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: deal_margins deal_margins_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_margins
    ADD CONSTRAINT deal_margins_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: deal_margins deal_margins_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_margins
    ADD CONSTRAINT deal_margins_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id) ON DELETE SET NULL;


--
-- Name: delivery_receipts delivery_receipts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_receipts
    ADD CONSTRAINT delivery_receipts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: delivery_receipts delivery_receipts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_receipts
    ADD CONSTRAINT delivery_receipts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: delivery_receipts delivery_receipts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_receipts
    ADD CONSTRAINT delivery_receipts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: delivery_receipts delivery_receipts_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_receipts
    ADD CONSTRAINT delivery_receipts_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id);


--
-- Name: delivery_receipts delivery_receipts_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_receipts
    ADD CONSTRAINT delivery_receipts_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id);


--
-- Name: demand_forecasts demand_forecasts_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demand_forecasts
    ADD CONSTRAINT demand_forecasts_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: documents documents_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.documents(id);


--
-- Name: documents documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: domain_events domain_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domain_events
    ADD CONSTRAINT domain_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: e_invoices e_invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.e_invoices
    ADD CONSTRAINT e_invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: e_invoices e_invoices_replacement_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.e_invoices
    ADD CONSTRAINT e_invoices_replacement_invoice_id_fkey FOREIGN KEY (replacement_invoice_id) REFERENCES public.e_invoices(id);


--
-- Name: e_invoices e_invoices_revenue_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.e_invoices
    ADD CONSTRAINT e_invoices_revenue_invoice_id_fkey FOREIGN KEY (revenue_invoice_id) REFERENCES public.revenue_invoices(id);


--
-- Name: employee_monthly_kpi employee_monthly_kpi_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_monthly_kpi
    ADD CONSTRAINT employee_monthly_kpi_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: error_log error_log_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_log
    ADD CONSTRAINT error_log_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: error_log error_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_log
    ADD CONSTRAINT error_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: file_meta file_meta_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_meta
    ADD CONSTRAINT file_meta_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: file_review_status file_review_status_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_review_status
    ADD CONSTRAINT file_review_status_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: fiscal_periods fiscal_periods_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.users(id);


--
-- Name: inventory_movements fk_invmov_product_code; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT fk_invmov_product_code FOREIGN KEY (product_code) REFERENCES public.inventory(product_code);


--
-- Name: help_articles help_articles_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.help_articles
    ADD CONSTRAINT help_articles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: import_export_tracking import_export_tracking_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_export_tracking
    ADD CONSTRAINT import_export_tracking_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: import_export_tracking import_export_tracking_hs_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_export_tracking
    ADD CONSTRAINT import_export_tracking_hs_code_id_fkey FOREIGN KEY (hs_code_id) REFERENCES public.hs_codes(id);


--
-- Name: import_export_tracking import_export_tracking_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_export_tracking
    ADD CONSTRAINT import_export_tracking_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: imv_consolidated imv_consolidated_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_consolidated
    ADD CONSTRAINT imv_consolidated_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: imv_consolidated imv_consolidated_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_consolidated
    ADD CONSTRAINT imv_consolidated_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: imv_consolidated imv_consolidated_purchaser_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_consolidated
    ADD CONSTRAINT imv_consolidated_purchaser_id_fkey FOREIGN KEY (purchaser_id) REFERENCES public.users(id);


--
-- Name: imv_consolidated imv_consolidated_sales_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_consolidated
    ADD CONSTRAINT imv_consolidated_sales_person_id_fkey FOREIGN KEY (sales_person_id) REFERENCES public.users(id);


--
-- Name: imv_inquiries imv_inquiries_hs_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_inquiries
    ADD CONSTRAINT imv_inquiries_hs_code_id_fkey FOREIGN KEY (hs_code_id) REFERENCES public.hs_codes(id);


--
-- Name: imv_inquiries imv_inquiries_person_in_charge_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_inquiries
    ADD CONSTRAINT imv_inquiries_person_in_charge_fkey FOREIGN KEY (person_in_charge) REFERENCES public.users(id);


--
-- Name: imv_inquiries imv_inquiries_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_inquiries
    ADD CONSTRAINT imv_inquiries_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: imv_inquiries imv_inquiries_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_inquiries
    ADD CONSTRAINT imv_inquiries_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: imv_purchase_orders imv_purchase_orders_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_purchase_orders
    ADD CONSTRAINT imv_purchase_orders_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: imv_purchase_orders imv_purchase_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imv_purchase_orders
    ADD CONSTRAINT imv_purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: inventory_movements inventory_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: inventory_movements inventory_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: inventory inventory_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: invoice_items invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_items invoice_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_ar_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_ar_id_fkey FOREIGN KEY (ar_id) REFERENCES public.accounts_receivable(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: invoices invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;


--
-- Name: invoices invoices_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id) ON DELETE SET NULL;


--
-- Name: leave_balance leave_balance_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_balance
    ADD CONSTRAINT leave_balance_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: leave_requests leave_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: leave_requests leave_requests_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(id);


--
-- Name: leave_requests leave_requests_rejected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES public.users(id);


--
-- Name: leave_requests leave_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: notifications notifications_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id);


--
-- Name: notifications notifications_recipient_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_recipient_vendor_id_fkey FOREIGN KEY (recipient_vendor_id) REFERENCES public.vendor_accounts(id);


--
-- Name: ocr_results ocr_results_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_results
    ADD CONSTRAINT ocr_results_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: ocr_results ocr_results_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_results
    ADD CONSTRAINT ocr_results_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id);


--
-- Name: payment_requests payment_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: payment_requests payment_requests_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: payment_requests payment_requests_rejected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES public.users(id);


--
-- Name: payment_requests payment_requests_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.users(id);


--
-- Name: payment_requests payment_requests_sourcing_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_sourcing_order_id_fkey FOREIGN KEY (sourcing_order_id) REFERENCES public.sourcing_orders(id) ON DELETE SET NULL;


--
-- Name: payment_requests payment_requests_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflow_instances(id);


--
-- Name: payment_transactions payment_transactions_ap_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_ap_id_fkey FOREIGN KEY (ap_id) REFERENCES public.accounts_payable(id);


--
-- Name: payment_transactions payment_transactions_ar_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_ar_id_fkey FOREIGN KEY (ar_id) REFERENCES public.accounts_receivable(id);


--
-- Name: payment_transactions payment_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pet_exp_log pet_exp_log_user_pet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pet_exp_log
    ADD CONSTRAINT pet_exp_log_user_pet_id_fkey FOREIGN KEY (user_pet_id) REFERENCES public.user_pets(id) ON DELETE CASCADE;


--
-- Name: po_line_items po_line_items_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_line_items
    ADD CONSTRAINT po_line_items_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: po_line_items po_line_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_line_items
    ADD CONSTRAINT po_line_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: price_history price_history_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id);


--
-- Name: price_history price_history_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: procrastinate_events procrastinate_events_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procrastinate_events
    ADD CONSTRAINT procrastinate_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.procrastinate_jobs(id) ON DELETE CASCADE;


--
-- Name: procrastinate_periodic_defers procrastinate_periodic_defers_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procrastinate_periodic_defers
    ADD CONSTRAINT procrastinate_periodic_defers_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.procrastinate_jobs(id);


--
-- Name: procurement_audit_log procurement_audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_audit_log
    ADD CONSTRAINT procurement_audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: procurement_audit_log procurement_audit_log_actor_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_audit_log
    ADD CONSTRAINT procurement_audit_log_actor_vendor_id_fkey FOREIGN KEY (actor_vendor_id) REFERENCES public.vendor_accounts(id);


--
-- Name: procurement_awards procurement_awards_awarded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_awards
    ADD CONSTRAINT procurement_awards_awarded_by_fkey FOREIGN KEY (awarded_by) REFERENCES public.users(id);


--
-- Name: procurement_awards procurement_awards_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_awards
    ADD CONSTRAINT procurement_awards_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.procurement_rfq_batches(id) ON DELETE CASCADE;


--
-- Name: procurement_awards procurement_awards_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_awards
    ADD CONSTRAINT procurement_awards_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.procurement_rfq_items(id) ON DELETE CASCADE;


--
-- Name: procurement_awards procurement_awards_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_awards
    ADD CONSTRAINT procurement_awards_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.vendor_quotes(id);


--
-- Name: procurement_awards procurement_awards_quote_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_awards
    ADD CONSTRAINT procurement_awards_quote_item_id_fkey FOREIGN KEY (quote_item_id) REFERENCES public.vendor_quote_items(id);


--
-- Name: procurement_awards procurement_awards_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_awards
    ADD CONSTRAINT procurement_awards_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.procurement_awards(id);


--
-- Name: procurement_awards procurement_awards_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_awards
    ADD CONSTRAINT procurement_awards_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendor_accounts(id);


--
-- Name: procurement_awards procurement_awards_written_back_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_awards
    ADD CONSTRAINT procurement_awards_written_back_by_fkey FOREIGN KEY (written_back_by) REFERENCES public.users(id);


--
-- Name: procurement_bid_tokens procurement_bid_tokens_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_bid_tokens
    ADD CONSTRAINT procurement_bid_tokens_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.procurement_rfq_batches(id) ON DELETE CASCADE;


--
-- Name: procurement_bid_tokens procurement_bid_tokens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_bid_tokens
    ADD CONSTRAINT procurement_bid_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: procurement_bid_tokens procurement_bid_tokens_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_bid_tokens
    ADD CONSTRAINT procurement_bid_tokens_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: procurement_bid_tokens procurement_bid_tokens_submitted_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_bid_tokens
    ADD CONSTRAINT procurement_bid_tokens_submitted_quote_id_fkey FOREIGN KEY (submitted_quote_id) REFERENCES public.vendor_quotes(id);


--
-- Name: procurement_bid_tokens procurement_bid_tokens_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_bid_tokens
    ADD CONSTRAINT procurement_bid_tokens_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendor_accounts(id);


--
-- Name: procurement_contract_items procurement_contract_items_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_contract_items
    ADD CONSTRAINT procurement_contract_items_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.procurement_contracts(id) ON DELETE CASCADE;


--
-- Name: procurement_contract_items procurement_contract_items_rfq_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_contract_items
    ADD CONSTRAINT procurement_contract_items_rfq_item_id_fkey FOREIGN KEY (rfq_item_id) REFERENCES public.procurement_rfq_items(id);


--
-- Name: procurement_contracts procurement_contracts_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_contracts
    ADD CONSTRAINT procurement_contracts_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.procurement_rfq_batches(id);


--
-- Name: procurement_contracts procurement_contracts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_contracts
    ADD CONSTRAINT procurement_contracts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: procurement_contracts procurement_contracts_signed_by_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_contracts
    ADD CONSTRAINT procurement_contracts_signed_by_user_fkey FOREIGN KEY (signed_by_user) REFERENCES public.users(id);


--
-- Name: procurement_contracts procurement_contracts_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_contracts
    ADD CONSTRAINT procurement_contracts_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendor_accounts(id);


--
-- Name: procurement_deliveries procurement_deliveries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_deliveries
    ADD CONSTRAINT procurement_deliveries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: procurement_deliveries procurement_deliveries_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_deliveries
    ADD CONSTRAINT procurement_deliveries_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.procurement_pos(id) ON DELETE CASCADE;


--
-- Name: procurement_deliveries procurement_deliveries_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_deliveries
    ADD CONSTRAINT procurement_deliveries_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.users(id);


--
-- Name: procurement_deliveries procurement_deliveries_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_deliveries
    ADD CONSTRAINT procurement_deliveries_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendor_accounts(id);


--
-- Name: procurement_delivery_items procurement_delivery_items_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_delivery_items
    ADD CONSTRAINT procurement_delivery_items_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.users(id);


--
-- Name: procurement_delivery_items procurement_delivery_items_delivery_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_delivery_items
    ADD CONSTRAINT procurement_delivery_items_delivery_id_fkey FOREIGN KEY (delivery_id) REFERENCES public.procurement_deliveries(id) ON DELETE CASCADE;


--
-- Name: procurement_delivery_items procurement_delivery_items_po_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_delivery_items
    ADD CONSTRAINT procurement_delivery_items_po_item_id_fkey FOREIGN KEY (po_item_id) REFERENCES public.procurement_po_items(id);


--
-- Name: procurement_po_items procurement_po_items_contract_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_po_items
    ADD CONSTRAINT procurement_po_items_contract_item_id_fkey FOREIGN KEY (contract_item_id) REFERENCES public.procurement_contract_items(id);


--
-- Name: procurement_po_items procurement_po_items_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_po_items
    ADD CONSTRAINT procurement_po_items_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.procurement_pos(id) ON DELETE CASCADE;


--
-- Name: procurement_pos procurement_pos_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_pos
    ADD CONSTRAINT procurement_pos_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.vendor_accounts(id);


--
-- Name: procurement_pos procurement_pos_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_pos
    ADD CONSTRAINT procurement_pos_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.procurement_rfq_batches(id);


--
-- Name: procurement_pos procurement_pos_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_pos
    ADD CONSTRAINT procurement_pos_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.procurement_contracts(id);


--
-- Name: procurement_pos procurement_pos_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_pos
    ADD CONSTRAINT procurement_pos_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: procurement_pos procurement_pos_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_pos
    ADD CONSTRAINT procurement_pos_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendor_accounts(id);


--
-- Name: procurement_rfq_batches procurement_rfq_batches_approval_rejected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_batches
    ADD CONSTRAINT procurement_rfq_batches_approval_rejected_by_fkey FOREIGN KEY (approval_rejected_by) REFERENCES public.users(id);


--
-- Name: procurement_rfq_batches procurement_rfq_batches_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_batches
    ADD CONSTRAINT procurement_rfq_batches_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: procurement_rfq_batches procurement_rfq_batches_award_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_batches
    ADD CONSTRAINT procurement_rfq_batches_award_approved_by_fkey FOREIGN KEY (award_approved_by) REFERENCES public.users(id);


--
-- Name: procurement_rfq_batches procurement_rfq_batches_award_proposed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_batches
    ADD CONSTRAINT procurement_rfq_batches_award_proposed_by_fkey FOREIGN KEY (award_proposed_by) REFERENCES public.users(id);


--
-- Name: procurement_rfq_batches procurement_rfq_batches_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_batches
    ADD CONSTRAINT procurement_rfq_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: procurement_rfq_batches procurement_rfq_batches_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_batches
    ADD CONSTRAINT procurement_rfq_batches_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id);


--
-- Name: procurement_rfq_invitations procurement_rfq_invitations_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_invitations
    ADD CONSTRAINT procurement_rfq_invitations_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.procurement_rfq_batches(id) ON DELETE CASCADE;


--
-- Name: procurement_rfq_invitations procurement_rfq_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_invitations
    ADD CONSTRAINT procurement_rfq_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id);


--
-- Name: procurement_rfq_invitations procurement_rfq_invitations_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_invitations
    ADD CONSTRAINT procurement_rfq_invitations_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendor_accounts(id);


--
-- Name: procurement_rfq_items procurement_rfq_items_awarded_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_items
    ADD CONSTRAINT procurement_rfq_items_awarded_vendor_id_fkey FOREIGN KEY (awarded_vendor_id) REFERENCES public.vendor_accounts(id);


--
-- Name: procurement_rfq_items procurement_rfq_items_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_items
    ADD CONSTRAINT procurement_rfq_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.procurement_rfq_batches(id) ON DELETE CASCADE;


--
-- Name: procurement_rfq_messages procurement_rfq_messages_author_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_messages
    ADD CONSTRAINT procurement_rfq_messages_author_admin_id_fkey FOREIGN KEY (author_admin_id) REFERENCES public.users(id);


--
-- Name: procurement_rfq_messages procurement_rfq_messages_author_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_messages
    ADD CONSTRAINT procurement_rfq_messages_author_vendor_id_fkey FOREIGN KEY (author_vendor_id) REFERENCES public.vendor_accounts(id);


--
-- Name: procurement_rfq_messages procurement_rfq_messages_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_messages
    ADD CONSTRAINT procurement_rfq_messages_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.procurement_rfq_batches(id) ON DELETE CASCADE;


--
-- Name: procurement_rfq_messages procurement_rfq_messages_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_messages
    ADD CONSTRAINT procurement_rfq_messages_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendor_accounts(id);


--
-- Name: procurement_rfq_shared_files procurement_rfq_shared_files_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_shared_files
    ADD CONSTRAINT procurement_rfq_shared_files_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.procurement_rfq_batches(id) ON DELETE CASCADE;


--
-- Name: procurement_rfq_shared_files procurement_rfq_shared_files_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_rfq_shared_files
    ADD CONSTRAINT procurement_rfq_shared_files_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.procurement_rfq_items(id) ON DELETE CASCADE;


--
-- Name: products products_hs_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_hs_code_id_fkey FOREIGN KEY (hs_code_id) REFERENCES public.hs_codes(id);


--
-- Name: products products_material_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_material_type_id_fkey FOREIGN KEY (material_type_id) REFERENCES public.material_types(id);


--
-- Name: purchase_orders purchase_orders_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: purchase_orders purchase_orders_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: purchase_orders purchase_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: purchase_orders purchase_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: purchase_orders purchase_orders_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id) ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: purchase_orders purchase_orders_supplier_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_quote_id_fkey FOREIGN KEY (supplier_quote_id) REFERENCES public.supplier_quotes(id) ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflow_instances(id);


--
-- Name: quotation_templates quotation_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_templates
    ADD CONSTRAINT quotation_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: quotations quotations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: quotations quotations_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.quotation_templates(id);


--
-- Name: quote_batches quote_batches_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_batches
    ADD CONSTRAINT quote_batches_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: report_executions report_executions_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_executions
    ADD CONSTRAINT report_executions_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.scheduled_reports(id);


--
-- Name: revenue_chain revenue_chain_ap_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_chain
    ADD CONSTRAINT revenue_chain_ap_id_fkey FOREIGN KEY (ap_id) REFERENCES public.accounts_payable(id) ON DELETE SET NULL;


--
-- Name: revenue_chain revenue_chain_ar_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_chain
    ADD CONSTRAINT revenue_chain_ar_id_fkey FOREIGN KEY (ar_id) REFERENCES public.accounts_receivable(id) ON DELETE SET NULL;


--
-- Name: revenue_chain revenue_chain_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_chain
    ADD CONSTRAINT revenue_chain_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: revenue_chain revenue_chain_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_chain
    ADD CONSTRAINT revenue_chain_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: revenue_chain revenue_chain_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_chain
    ADD CONSTRAINT revenue_chain_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: revenue_chain revenue_chain_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_chain
    ADD CONSTRAINT revenue_chain_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.bqms_rfq(id) ON DELETE SET NULL;


--
-- Name: revenue_chain revenue_chain_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_chain
    ADD CONSTRAINT revenue_chain_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id) ON DELETE SET NULL;


--
-- Name: revenue_chain revenue_chain_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_chain
    ADD CONSTRAINT revenue_chain_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE SET NULL;


--
-- Name: revenue_chain revenue_chain_supplier_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_chain
    ADD CONSTRAINT revenue_chain_supplier_quote_id_fkey FOREIGN KEY (supplier_quote_id) REFERENCES public.supplier_quotes(id) ON DELETE SET NULL;


--
-- Name: revenue_invoices revenue_invoices_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_invoices
    ADD CONSTRAINT revenue_invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: revenue_invoices revenue_invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_invoices
    ADD CONSTRAINT revenue_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: revenue_invoices revenue_invoices_imv_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_invoices
    ADD CONSTRAINT revenue_invoices_imv_po_id_fkey FOREIGN KEY (imv_po_id) REFERENCES public.imv_purchase_orders(id);


--
-- Name: revenue_invoices revenue_invoices_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_invoices
    ADD CONSTRAINT revenue_invoices_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id);


--
-- Name: revenue_invoices revenue_invoices_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_invoices
    ADD CONSTRAINT revenue_invoices_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: revenue_invoices revenue_invoices_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_invoices
    ADD CONSTRAINT revenue_invoices_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id);


--
-- Name: revenue_invoices revenue_invoices_samsung_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_invoices
    ADD CONSTRAINT revenue_invoices_samsung_po_id_fkey FOREIGN KEY (samsung_po_id) REFERENCES public.bqms_samsung_po(id);


--
-- Name: rfq_line_items rfq_line_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_line_items
    ADD CONSTRAINT rfq_line_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: rfq_line_items rfq_line_items_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_line_items
    ADD CONSTRAINT rfq_line_items_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.rfq_requests(id) ON DELETE CASCADE;


--
-- Name: rfq_quotations rfq_quotations_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_quotations
    ADD CONSTRAINT rfq_quotations_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.rfq_requests(id);


--
-- Name: rfq_quotations rfq_quotations_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_quotations
    ADD CONSTRAINT rfq_quotations_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: rfq_requests rfq_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_requests
    ADD CONSTRAINT rfq_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: sales_order_items sales_order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_items
    ADD CONSTRAINT sales_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: sales_order_items sales_order_items_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_items
    ADD CONSTRAINT sales_order_items_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id) ON DELETE CASCADE;


--
-- Name: sales_orders sales_orders_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: sales_orders sales_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: sales_orders sales_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: sales_orders sales_orders_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.bqms_rfq(id) ON DELETE SET NULL;


--
-- Name: samsung_watchdog_events samsung_watchdog_events_processed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.samsung_watchdog_events
    ADD CONSTRAINT samsung_watchdog_events_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.users(id);


--
-- Name: scheduled_reports scheduled_reports_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_reports
    ADD CONSTRAINT scheduled_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: security_log security_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_log
    ADD CONSTRAINT security_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: shipment_items shipment_items_po_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_items
    ADD CONSTRAINT shipment_items_po_line_id_fkey FOREIGN KEY (po_line_id) REFERENCES public.po_line_items(id) ON DELETE SET NULL;


--
-- Name: shipment_items shipment_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_items
    ADD CONSTRAINT shipment_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: shipment_items shipment_items_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_items
    ADD CONSTRAINT shipment_items_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;


--
-- Name: shipments shipments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: shipments shipments_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE RESTRICT;


--
-- Name: shipments shipments_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;


--
-- Name: sourcing_entries sourcing_entries_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_entries
    ADD CONSTRAINT sourcing_entries_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: sourcing_order_status_history sourcing_order_status_history_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_order_status_history
    ADD CONSTRAINT sourcing_order_status_history_by_user_id_fkey FOREIGN KEY (by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sourcing_order_status_history sourcing_order_status_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_order_status_history
    ADD CONSTRAINT sourcing_order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.sourcing_orders(id) ON DELETE CASCADE;


--
-- Name: sourcing_orders sourcing_orders_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_orders
    ADD CONSTRAINT sourcing_orders_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sourcing_orders sourcing_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_orders
    ADD CONSTRAINT sourcing_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: sourcing_orders sourcing_orders_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_orders
    ADD CONSTRAINT sourcing_orders_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id) ON DELETE SET NULL;


--
-- Name: sourcing_pricing_snapshots sourcing_pricing_snapshots_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_pricing_snapshots
    ADD CONSTRAINT sourcing_pricing_snapshots_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.sourcing_entries(id) ON DELETE CASCADE;


--
-- Name: sourcing_supplier_prices sourcing_supplier_prices_sourcing_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_supplier_prices
    ADD CONSTRAINT sourcing_supplier_prices_sourcing_entry_id_fkey FOREIGN KEY (sourcing_entry_id) REFERENCES public.sourcing_entries(id) ON DELETE CASCADE;


--
-- Name: sourcing_vn_shipping_history sourcing_vn_shipping_history_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_vn_shipping_history
    ADD CONSTRAINT sourcing_vn_shipping_history_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.sourcing_entries(id) ON DELETE CASCADE;


--
-- Name: stock_alerts stock_alerts_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_alerts
    ADD CONSTRAINT stock_alerts_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: stock_alerts stock_alerts_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_alerts
    ADD CONSTRAINT stock_alerts_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: supplier_contracts supplier_contracts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_contracts
    ADD CONSTRAINT supplier_contracts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: supplier_contracts supplier_contracts_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_contracts
    ADD CONSTRAINT supplier_contracts_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: supplier_product_map supplier_product_map_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_product_map
    ADD CONSTRAINT supplier_product_map_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: supplier_product_map supplier_product_map_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_product_map
    ADD CONSTRAINT supplier_product_map_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;


--
-- Name: supplier_quote_items supplier_quote_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_quote_items
    ADD CONSTRAINT supplier_quote_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: supplier_quote_items supplier_quote_items_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_quote_items
    ADD CONSTRAINT supplier_quote_items_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.supplier_quotes(id) ON DELETE CASCADE;


--
-- Name: supplier_quotes supplier_quotes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_quotes
    ADD CONSTRAINT supplier_quotes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: supplier_quotes supplier_quotes_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_quotes
    ADD CONSTRAINT supplier_quotes_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.bqms_rfq(id) ON DELETE SET NULL;


--
-- Name: supplier_quotes supplier_quotes_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_quotes
    ADD CONSTRAINT supplier_quotes_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id) ON DELETE SET NULL;


--
-- Name: supplier_quotes supplier_quotes_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_quotes
    ADD CONSTRAINT supplier_quotes_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;


--
-- Name: supplier_ratings supplier_ratings_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_ratings
    ADD CONSTRAINT supplier_ratings_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;


--
-- Name: supplier_scores supplier_scores_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_scores
    ADD CONSTRAINT supplier_scores_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: suppliers suppliers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: system_config system_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT system_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: system_settings system_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: taggings taggings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taggings
    ADD CONSTRAINT taggings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: taggings taggings_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taggings
    ADD CONSTRAINT taggings_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: tags tags_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: task_assignments task_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignments
    ADD CONSTRAINT task_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: task_assignments task_assignments_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignments
    ADD CONSTRAINT task_assignments_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: tasks tasks_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: tasks tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: user_activity_log user_activity_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity_log
    ADD CONSTRAINT user_activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_pets user_pets_species_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_pets
    ADD CONSTRAINT user_pets_species_fkey FOREIGN KEY (species) REFERENCES public.pet_species_catalog(species);


--
-- Name: user_pets user_pets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_pets
    ADD CONSTRAINT user_pets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_sessions user_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: users users_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: vendor_accounts vendor_accounts_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_accounts
    ADD CONSTRAINT vendor_accounts_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: vendor_accounts vendor_accounts_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_accounts
    ADD CONSTRAINT vendor_accounts_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id);


--
-- Name: vendor_accounts vendor_accounts_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_accounts
    ADD CONSTRAINT vendor_accounts_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: vendor_accounts vendor_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_accounts
    ADD CONSTRAINT vendor_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: vendor_quote_items vendor_quote_items_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_quote_items
    ADD CONSTRAINT vendor_quote_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.procurement_rfq_items(id);


--
-- Name: vendor_quote_items vendor_quote_items_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_quote_items
    ADD CONSTRAINT vendor_quote_items_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.vendor_quotes(id) ON DELETE CASCADE;


--
-- Name: vendor_quotes vendor_quotes_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_quotes
    ADD CONSTRAINT vendor_quotes_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.procurement_rfq_batches(id);


--
-- Name: vendor_quotes vendor_quotes_submitted_via_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_quotes
    ADD CONSTRAINT vendor_quotes_submitted_via_token_id_fkey FOREIGN KEY (submitted_via_token_id) REFERENCES public.procurement_bid_tokens(id);


--
-- Name: vendor_quotes vendor_quotes_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_quotes
    ADD CONSTRAINT vendor_quotes_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendor_accounts(id);


--
-- Name: workflow_history workflow_history_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_history
    ADD CONSTRAINT workflow_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: workflow_history workflow_history_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_history
    ADD CONSTRAINT workflow_history_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.workflow_instances(id) ON DELETE CASCADE;


--
-- Name: workflow_instances workflow_instances_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instances
    ADD CONSTRAINT workflow_instances_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: workflow_instances workflow_instances_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instances
    ADD CONSTRAINT workflow_instances_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: file_meta; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.file_meta ENABLE ROW LEVEL SECURITY;

--
-- Name: file_meta fm_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fm_admin ON public.file_meta USING ((current_setting('app.current_user_role'::text, true) = 'admin'::text));


--
-- Name: file_meta fm_manager; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fm_manager ON public.file_meta FOR SELECT USING ((current_setting('app.current_user_role'::text, true) = 'manager'::text));


--
-- Name: file_meta fm_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fm_own ON public.file_meta USING ((uploaded_by = (current_setting('app.current_user_id'::text, true))::uuid));


--
-- Name: file_meta fm_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fm_public ON public.file_meta FOR SELECT USING ((is_public = true));


--
-- Name: notifications notif_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_admin_all ON public.notifications FOR SELECT USING ((current_setting('app.current_user_role'::text, true) = 'admin'::text));


--
-- Name: notifications notif_own_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_own_only ON public.notifications USING ((recipient_id = (current_setting('app.current_user_id'::text, true))::uuid));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_orders po_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY po_full_access ON public.purchase_orders USING ((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['admin'::text, 'manager'::text, 'procurement'::text, 'accountant'::text])));


--
-- Name: purchase_orders po_warehouse_transit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY po_warehouse_transit ON public.purchase_orders FOR SELECT USING (((current_setting('app.current_user_role'::text, true) = 'warehouse'::text) AND (status = ANY (ARRAY['in_transit'::public.po_status, 'partial_received'::public.po_status, 'received'::public.po_status]))));


--
-- Name: purchase_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_instances wf_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wf_admin_all ON public.workflow_instances USING ((current_setting('app.current_user_role'::text, true) = ANY (ARRAY['admin'::text, 'manager'::text])));


--
-- Name: workflow_instances wf_staff_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wf_staff_own ON public.workflow_instances USING (((created_by = (current_setting('app.current_user_id'::text, true))::uuid) OR (assigned_to = (current_setting('app.current_user_id'::text, true))::uuid)));


--
-- Name: workflow_instances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workflow_instances ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict 04MEWBsBJgOYsybArl7QEbxgMkSUF9rv2hvSBPbA5cnTTbPQ6xFjbVFy92KeXuq

