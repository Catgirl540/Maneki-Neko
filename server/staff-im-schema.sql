-- Business events are captured in the very transaction that changes the task.
CREATE TABLE IF NOT EXISTS staff_im_bindings (
  id TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff_users(id),
  recipient_hash TEXT NOT NULL, revision TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_im_one_primary ON staff_im_bindings(staff_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_im_one_recipient ON staff_im_bindings(recipient_hash) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS staff_im_preferences (
  staff_id TEXT PRIMARY KEY REFERENCES staff_users(id), enabled BOOLEAN NOT NULL DEFAULT true,
  quiet_start TEXT, quiet_end TEXT, urgent_override BOOLEAN NOT NULL DEFAULT false, version BIGINT NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS staff_im_rules (
  id INTEGER PRIMARY KEY CHECK(id=1), version BIGINT NOT NULL DEFAULT 1,
  config JSONB NOT NULL DEFAULT '{"csrIds":[],"supervisorIds":[],"start":"00:00","end":"00:00"}', updated_by TEXT
);
INSERT INTO staff_im_rules(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS staff_im_outbox (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(), routed_at TIMESTAMPTZ, routing_status TEXT NOT NULL DEFAULT 'queued',next_route_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE staff_im_outbox ADD COLUMN IF NOT EXISTS next_route_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS staff_im_outbox_pending ON staff_im_outbox(occurred_at) WHERE routed_at IS NULL;
CREATE TABLE IF NOT EXISTS staff_im_cycles (
  ticket_id TEXT NOT NULL REFERENCES tickets(id), kind TEXT NOT NULL, cycle_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ,
  PRIMARY KEY(ticket_id,kind)
);
CREATE TABLE IF NOT EXISTS staff_im_notifications (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL, cycle_id TEXT, kind TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'initial',
  resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, staff_id TEXT NOT NULL,
  binding_id TEXT, binding_revision TEXT, rule_version BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  lease TEXT, lease_until TIMESTAMPTZ, attempt_id TEXT, sending_at TIMESTAMPTZ, sent_at TIMESTAMPTZ,
  error_code TEXT, receipt_id TEXT, UNIQUE(event_id,staff_id,kind,stage)
);
CREATE INDEX IF NOT EXISTS staff_im_notifications_due ON staff_im_notifications(available_at) WHERE status IN ('queued','retry_wait','deferred');
CREATE TABLE IF NOT EXISTS staff_im_attempts (
  id TEXT PRIMARY KEY, notification_id TEXT NOT NULL REFERENCES staff_im_notifications(id),
  status TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ, error_code TEXT, receipt_id TEXT
);
CREATE TABLE IF NOT EXISTS staff_write_requests (
  staff_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
  status INTEGER NOT NULL, response TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(staff_id,request_id)
);
CREATE OR REPLACE FUNCTION staff_im_task_events() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task tickets%ROWTYPE; event_key TEXT;
BEGIN
  IF TG_TABLE_NAME='tickets' THEN
    IF TG_OP='INSERT' THEN
      INSERT INTO staff_im_outbox(id,kind,resource_type,resource_id) VALUES('ticket-created:'||NEW.id,'ticket_created','ticket',NEW.id) ON CONFLICT DO NOTHING;
      IF NEW.created_by LIKE 'customer:%' OR NEW.created_by='agent' THEN
        INSERT INTO staff_im_cycles(ticket_id,kind,cycle_id) VALUES(NEW.id,'assignment',NEW.id||':assignment:'||NEW.version) ON CONFLICT DO NOTHING;
      END IF;
    ELSE
      IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id AND NOT (OLD.assignee_id IS NULL AND OLD.status='open' AND NEW.status='processing') THEN
        INSERT INTO staff_im_outbox(id,kind,resource_type,resource_id) VALUES('ticket-assigned:'||NEW.id||':'||NEW.version,'ticket_assigned','ticket',NEW.id) ON CONFLICT DO NOTHING;
        IF NEW.status='open' THEN
          INSERT INTO staff_im_cycles(ticket_id,kind,cycle_id) VALUES(NEW.id,'assignment',NEW.id||':assignment:'||NEW.version)
          ON CONFLICT(ticket_id,kind) DO UPDATE SET cycle_id=EXCLUDED.cycle_id,started_at=now(),closed_at=NULL;
        END IF;
      END IF;
      IF NEW.status IN ('processing','waiting','resolved','suspended') THEN
        UPDATE staff_im_cycles SET closed_at=COALESCE(closed_at,now()) WHERE ticket_id=NEW.id AND kind='assignment';
      END IF;
      IF NEW.status IN ('waiting','resolved','suspended') THEN
        UPDATE staff_im_cycles SET closed_at=COALESCE(closed_at,now()) WHERE ticket_id=NEW.id AND kind='response';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO staff_im_outbox(id,kind,resource_type,resource_id) VALUES('ticket-state:'||NEW.id||':'||NEW.version,'ticket_state','ticket',NEW.id) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME='ticket_messages' THEN
    SELECT * INTO task FROM tickets WHERE id=NEW.ticket_id FOR UPDATE;
    IF NEW.sender='customer' THEN
      INSERT INTO staff_im_cycles(ticket_id,kind,cycle_id) VALUES(NEW.ticket_id,'response',NEW.id)
      ON CONFLICT(ticket_id,kind) DO UPDATE SET cycle_id=EXCLUDED.cycle_id,started_at=now(),closed_at=NULL WHERE staff_im_cycles.closed_at IS NOT NULL;
      INSERT INTO staff_im_outbox(id,kind,resource_type,resource_id) VALUES('customer-message:'||NEW.id,'customer_message','ticket',NEW.ticket_id) ON CONFLICT DO NOTHING;
    ELSIF NEW.sender='staff' AND (NEW.visible_to_customer=1 OR task.created_by LIKE 'customer:%') THEN
      UPDATE staff_im_cycles SET closed_at=COALESCE(closed_at,now()) WHERE ticket_id=NEW.ticket_id AND kind='response';
    END IF;
  ELSIF TG_TABLE_NAME='approvals' THEN
    IF TG_OP='INSERT' THEN
      INSERT INTO staff_im_outbox(id,kind,resource_type,resource_id) VALUES('approval-created:'||NEW.id,'approval_created','approval',NEW.id) ON CONFLICT DO NOTHING;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO staff_im_outbox(id,kind,resource_type,resource_id) VALUES('approval-state:'||NEW.id||':'||NEW.status,'approval_state','approval',NEW.id) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER staff_im_tickets AFTER INSERT OR UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION staff_im_task_events();
CREATE OR REPLACE TRIGGER staff_im_messages AFTER INSERT ON ticket_messages FOR EACH ROW EXECUTE FUNCTION staff_im_task_events();
CREATE OR REPLACE TRIGGER staff_im_approvals AFTER INSERT OR UPDATE ON approvals FOR EACH ROW EXECUTE FUNCTION staff_im_task_events();
