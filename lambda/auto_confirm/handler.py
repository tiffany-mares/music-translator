"""Cognito pre-sign-up trigger: auto-confirm every new account (user decision
2026-08-02 - no email verification step). Also marks the email verified so
account recovery keeps working. No AWS calls - pure event transform."""


def handler(event, context):
    event["response"]["autoConfirmUser"] = True
    if "email" in event.get("request", {}).get("userAttributes", {}):
        event["response"]["autoVerifyEmail"] = True
    return event
