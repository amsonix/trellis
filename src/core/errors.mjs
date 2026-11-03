export class ProtocolError extends Error {
  constructor(code, message, details = {}, exitCode = 3) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

export class UsageError extends ProtocolError {
  constructor(message, details = {}) {
    super('USAGE', message, details, 2);
    this.name = 'UsageError';
  }
}

export class UnavailableError extends ProtocolError {
  constructor(message, details = {}) {
    super('UNAVAILABLE', message, details, 4);
    this.name = 'UnavailableError';
  }
}

export class RefusedError extends ProtocolError {
  constructor(code, message, details = {}) {
    super(code, message, details, 3);
    this.name = 'RefusedError';
  }
}
