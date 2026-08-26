function redact_secrets(tag, timestamp, record)
    local secret_keys = {
        "token", "registration_token", "access_token", "authorization",
        "password", "client_secret", "api_key", "GITHUB_TOKEN"
    }
    for _, key in ipairs(secret_keys) do
        if record[key] ~= nil then
            record[key] = "[REDACTED]"
        end
    end
    if record["message"] ~= nil then
        record["message"] = string.gsub(record["message"], "([Tt]oken%s*=%s*)[^%s]+", "%1[REDACTED]")
        record["message"] = string.gsub(record["message"], "([Aa]uthorization:%s*[Bb]earer%s+)[^%s]+", "%1[REDACTED]")
    end
    return 1, timestamp, record
end
