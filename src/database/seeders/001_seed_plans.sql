-- src/database/seeds/001_seed_plans.sql

-- Insert default plans
INSERT INTO plans (name, slug, description, price, currency, interval, trial_days, features, limits, is_active, is_popular, sort_order)
VALUES 
    (
        'Free',
        'free',
        'Perfect for getting started',
        0.00,
        'USD',
        'monthly',
        0,
        '["Basic features", "Community support", "1 project"]'::jsonb,
        '{"projects": 1, "storage_mb": 100, "api_calls": 1000}'::jsonb,
        true,
        false,
        1
    ),
    (
        'Starter',
        'starter',
        'Great for individuals and small teams',
        9.99,
        'USD',
        'monthly',
        14,
        '["Everything in Free", "5 projects", "Email support", "API access", "Basic analytics"]'::jsonb,
        '{"projects": 5, "storage_mb": 1000, "api_calls": 10000}'::jsonb,
        true,
        false,
        2
    ),
    (
        'Professional',
        'professional',
        'Perfect for growing businesses',
        29.99,
        'USD',
        'monthly',
        14,
        '["Everything in Starter", "Unlimited projects", "Priority support", "Advanced analytics", "Custom integrations", "Team collaboration"]'::jsonb,
        '{"projects": -1, "storage_mb": 10000, "api_calls": 100000}'::jsonb,
        true,
        true,
        3
    ),
    (
        'Enterprise',
        'enterprise',
        'For large organizations',
        99.99,
        'USD',
        'monthly',
        30,
        '["Everything in Professional", "Dedicated support", "SLA guarantee", "Custom features", "On-premise option", "Advanced security"]'::jsonb,
        '{"projects": -1, "storage_mb": -1, "api_calls": -1}'::jsonb,
        true,
        false,
        4
    )
ON CONFLICT (slug) DO NOTHING;

-- Insert yearly plans
INSERT INTO plans (name, slug, description, price, currency, interval, interval_count, trial_days, features, limits, is_active, sort_order)
VALUES 
    (
        'Starter Yearly',
        'starter-yearly',
        'Great for individuals and small teams - Save 20%',
        95.90,
        'USD',
        'yearly',
        1,
        14,
        '["Everything in Free", "5 projects", "Email support", "API access", "Basic analytics"]'::jsonb,
        '{"projects": 5, "storage_mb": 1000, "api_calls": 10000}'::jsonb,
        true,
        5
    ),
    (
        'Professional Yearly',
        'professional-yearly',
        'Perfect for growing businesses - Save 20%',
        287.90,
        'USD',
        'yearly',
        1,
        14,
        '["Everything in Starter", "Unlimited projects", "Priority support", "Advanced analytics", "Custom integrations", "Team collaboration"]'::jsonb,
        '{"projects": -1, "storage_mb": 10000, "api_calls": 100000}'::jsonb,
        true,
        6
    )
ON CONFLICT (slug) DO NOTHING;

-- Insert default settings
INSERT INTO settings (key, value, description, is_public)
VALUES 
    ('app_name', '"Altuvera"', 'Application name', true),
    ('app_description', '"Your amazing SaaS platform"', 'Application description', true),
    ('support_email', '"support@altuvera.com"', 'Support email address', true),
    ('maintenance_mode', 'false', 'Enable maintenance mode', false),
    ('signup_enabled', 'true', 'Allow new user registrations', false),
    ('trial_enabled', 'true', 'Enable trial periods for subscriptions', false)
ON CONFLICT (key) DO NOTHING;