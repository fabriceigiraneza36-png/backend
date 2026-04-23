/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WEBAUTHN CLIENT IMPLEMENTATION EXAMPLE
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This is a complete example of implementing WebAuthn on the client side
 * Works with React, Vue, Vanilla JS, etc.
 * 
 * Installation:
 *   npm install @simplewebauthn/browser
 * 
 * Usage in React:
 *   import { WebAuthnClient } from './webauthn-client'
 *   const client = new WebAuthnClient('https://api.altuvera.com')
 */

import * as WebAuthnLib from '@simplewebauthn/browser';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  API_URL: process.env.REACT_APP_API_URL || 'http://localhost:5000',
  WEBAUTHN_ENDPOINT: '/auth/webauthn',
};

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

class WebAuthnError extends Error {
  constructor(message, code = 'WEBAUTHN_ERROR') {
    super(message);
    this.name = 'WebAuthnError';
    this.code = code;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBAUTHN CLIENT CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export class WebAuthnClient {
  constructor(apiUrl = CONFIG.API_URL) {
    this.apiUrl = apiUrl;
    this.token = localStorage.getItem('token');
    this.user = null;

    // Check browser support
    this.supportsWebAuthn = this.checkBrowserSupport();
  }

  /**
   * Check if browser supports WebAuthn
   */
  checkBrowserSupport() {
    const supported =
      window.PublicKeyCredential !== undefined &&
      navigator.credentials !== undefined &&
      navigator.credentials.create !== undefined &&
      navigator.credentials.get !== undefined;

    if (!supported) {
      console.warn('⚠️ WebAuthn not supported in this browser');
    }

    return supported;
  }

  /**
   * Make API request with error handling
   */
  async apiCall(endpoint, method = 'GET', body = null) {
    const url = `${this.apiUrl}${CONFIG.WEBAUTHN_ENDPOINT}${endpoint}`;

    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    // Add authorization header if token exists
    if (this.token) {
      options.headers['Authorization'] = `Bearer ${this.token}`;
    }

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      const data = await response.json();

      if (!data.success && !response.ok) {
        throw new WebAuthnError(
          data.message || 'API request failed',
          response.status
        );
      }

      return data;
    } catch (error) {
      if (error instanceof WebAuthnError) {
        throw error;
      }
      throw new WebAuthnError(`API request failed: ${error.message}`);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // REGISTRATION
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * Step 1: Get registration options
   */
  async getRegistrationOptions(email, name) {
    if (!email || !name) {
      throw new WebAuthnError('Email and name are required');
    }

    try {
      const response = await this.apiCall('/register-options', 'POST', {
        email,
        name,
      });

      return response.data;
    } catch (error) {
      throw new WebAuthnError(
        `Failed to get registration options: ${error.message}`
      );
    }
  }

  /**
   * Step 2: Create credential (browser interaction)
   */
  async createCredential(options) {
    if (!this.supportsWebAuthn) {
      throw new WebAuthnError('WebAuthn not supported in this browser');
    }

    try {
      // Convert base64 strings to ArrayBuffers
      const processedOptions = {
        ...options.options,
        challenge: this.base64ToArrayBuffer(options.options.challenge),
        user: {
          ...options.options.user,
          id: this.base64ToArrayBuffer(options.options.user.id),
        },
      };

      // Create credential via browser
      const credential = await navigator.credentials.create({
        publicKey: processedOptions,
      });

      if (!credential) {
        throw new WebAuthnError('Credential creation cancelled by user');
      }

      return credential;
    } catch (error) {
      if (error instanceof WebAuthnError) {
        throw error;
      }
      throw new WebAuthnError(`Credential creation failed: ${error.message}`);
    }
  }

  /**
   * Step 3: Verify registration
   */
  async verifyRegistration(email, name, sessionData, credential) {
    try {
      const response = await this.apiCall('/register-verify', 'POST', {
        email,
        name,
        webauthnUserIdB64: sessionData.webauthnUserIdB64,
        response: this.credentialToJSON(credential),
      });

      // Store token and user
      this.token = response.data.token;
      this.user = response.data.user;
      localStorage.setItem('token', this.token);

      return response.data;
    } catch (error) {
      throw new WebAuthnError(
        `Registration verification failed: ${error.message}`
      );
    }
  }

  /**
   * Complete registration flow
   */
  async register(email, name) {
    try {
      // Step 1: Get options
      const optionsData = await this.getRegistrationOptions(email, name);

      // Step 2: Create credential
      const credential = await this.createCredential(optionsData);

      // Step 3: Verify registration
      const result = await this.verifyRegistration(
        email,
        name,
        optionsData.sessionData,
        credential
      );

      console.log('✅ Registration successful');
      return result;
    } catch (error) {
      console.error('❌ Registration failed:', error.message);
      throw error;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * Step 1: Get login options
   */
  async getLoginOptions(email) {
    if (!email) {
      throw new WebAuthnError('Email is required');
    }

    try {
      const response = await this.apiCall('/login-options', 'POST', { email });
      return response.data;
    } catch (error) {
      throw new WebAuthnError(
        `Failed to get login options: ${error.message}`
      );
    }
  }

  /**
   * Step 2: Get assertion (browser interaction)
   */
  async getAssertion(options) {
    if (!this.supportsWebAuthn) {
      throw new WebAuthnError('WebAuthn not supported in this browser');
    }

    try {
      // Convert base64 to ArrayBuffer
      const processedOptions = {
        ...options.options,
        challenge: this.base64ToArrayBuffer(options.options.challenge),
        allowCredentials: options.options.allowCredentials.map(cred => ({
          ...cred,
          id: this.base64ToArrayBuffer(cred.id),
        })),
      };

      // Get assertion via browser
      const assertion = await navigator.credentials.get({
        publicKey: processedOptions,
      });

      if (!assertion) {
        throw new WebAuthnError('Authentication cancelled by user');
      }

      return assertion;
    } catch (error) {
      if (error instanceof WebAuthnError) {
        throw error;
      }
      throw new WebAuthnError(`Authentication failed: ${error.message}`);
    }
  }

  /**
   * Step 3: Verify login
   */
  async verifyLogin(email, assertion) {
    try {
      const response = await this.apiCall('/login-verify', 'POST', {
        email,
        response: this.credentialToJSON(assertion),
      });

      // Store token and user
      this.token = response.data.token;
      this.user = response.data.user;
      localStorage.setItem('token', this.token);

      return response.data;
    } catch (error) {
      throw new WebAuthnError(
        `Login verification failed: ${error.message}`
      );
    }
  }

  /**
   * Complete login flow
   */
  async login(email) {
    try {
      // Step 1: Get options
      const optionsData = await this.getLoginOptions(email);

      // Step 2: Get assertion
      const assertion = await this.getAssertion(optionsData);

      // Step 3: Verify login
      const result = await this.verifyLogin(email, assertion);

      console.log('✅ Login successful');
      return result;
    } catch (error) {
      console.error('❌ Login failed:', error.message);
      throw error;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // USER PROFILE
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * Get current user profile
   */
  async getProfile() {
    if (!this.token) {
      throw new WebAuthnError('Not authenticated');
    }

    try {
      const response = await this.apiCall('/me');
      this.user = response.data.user;
      return response.data;
    } catch (error) {
      throw new WebAuthnError(`Failed to get profile: ${error.message}`);
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(updates) {
    if (!this.token) {
      throw new WebAuthnError('Not authenticated');
    }

    try {
      const response = await this.apiCall('/profile', 'PATCH', updates);
      this.user = response.data.user;
      return response.data;
    } catch (error) {
      throw new WebAuthnError(`Failed to update profile: ${error.message}`);
    }
  }

  /**
   * Logout and revoke session
   */
  async logout() {
    if (!this.token) {
      throw new WebAuthnError('Not authenticated');
    }

    try {
      await this.apiCall('/logout', 'POST');
      this.token = null;
      this.user = null;
      localStorage.removeItem('token');
      console.log('✅ Logged out successfully');
    } catch (error) {
      throw new WebAuthnError(`Logout failed: ${error.message}`);
    }
  }

  /**
   * Delete a credential
   */
  async deleteCredential(credentialId) {
    if (!this.token) {
      throw new WebAuthnError('Not authenticated');
    }

    try {
      await this.apiCall(`/credential/${credentialId}`, 'DELETE');
      console.log('✅ Credential deleted');
    } catch (error) {
      throw new WebAuthnError(
        `Failed to delete credential: ${error.message}`
      );
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * Convert base64 string to ArrayBuffer
   */
  base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert credential to JSON for transmission
   */
  credentialToJSON(credential) {
    const clientDataJSON = credential.response.clientDataJSON
      ? this.arrayBufferToBase64(credential.response.clientDataJSON)
      : undefined;

    const attestationObject = credential.response.attestationObject
      ? this.arrayBufferToBase64(credential.response.attestationObject)
      : undefined;

    const authenticatorData = credential.response.authenticatorData
      ? this.arrayBufferToBase64(credential.response.authenticatorData)
      : undefined;

    const signature = credential.response.signature
      ? this.arrayBufferToBase64(credential.response.signature)
      : undefined;

    const userHandle = credential.response.userHandle
      ? this.arrayBufferToBase64(credential.response.userHandle)
      : undefined;

    return {
      id: credential.id,
      rawId: this.arrayBufferToBase64(credential.rawId),
      response: {
        clientDataJSON,
        attestationObject,
        authenticatorData,
        signature,
        userHandle,
      },
      type: credential.type,
    };
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.token && !!this.user;
  }

  /**
   * Get authentication token
   */
  getToken() {
    return this.token;
  }

  /**
   * Get current user
   */
  getUser() {
    return this.user;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REACT HOOKS (OPTIONAL)
// ═══════════════════════════════════════════════════════════════════════════════

export function useWebAuthn() {
  const [client] = React.useState(() => new WebAuthnClient());
  const [user, setUser] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const register = React.useCallback(async (email, name) => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.register(email, name);
      setUser(result.user);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const login = React.useCallback(async (email) => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.login(email);
      setUser(result.user);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await client.logout();
      setUser(null);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateProfile = React.useCallback(async (updates) => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.updateProfile(updates);
      setUser(result.user);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    client,
    user,
    loading,
    error,
    register,
    login,
    logout,
    updateProfile,
    isAuthenticated: client.isAuthenticated(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE USAGE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Vanilla JavaScript example:
 * 
 * const client = new WebAuthnClient('https://api.altuvera.com');
 * 
 * // Registration
 * const registrationResult = await client.register('user@example.com', 'John Doe');
 * console.log('User created:', registrationResult.user);
 * 
 * // Login
 * const loginResult = await client.login('user@example.com');
 * console.log('Logged in:', loginResult.user);
 * 
 * // Get profile
 * const profile = await client.getProfile();
 * console.log('Profile:', profile);
 * 
 * // Update profile
 * await client.updateProfile({
 *   phone: '+1234567890',
 *   nationality: 'Kenya'
 * });
 * 
 * // Logout
 * await client.logout();
 */

/**
 * React example:
 * 
 * function LoginPage() {
 *   const { login, loading, error, user, isAuthenticated } = useWebAuthn();
 *   const [email, setEmail] = React.useState('');
 *
 *   const handleLogin = async (e) => {
 *     e.preventDefault();
 *     try {
 *       await login(email);
 *       // Redirect to dashboard
 *     } catch (err) {
 *       console.error('Login failed:', err);
 *     }
 *   };
 *
 *   return (
 *     <form onSubmit={handleLogin}>
 *       <input
 *         type="email"
 *         value={email}
 *         onChange={(e) => setEmail(e.target.value)}
 *         placeholder="Email"
 *       />
 *       <button type="submit" disabled={loading}>
 *         {loading ? 'Logging in...' : 'Login with Passkey'}
 *       </button>
 *       {error && <div className="error">{error}</div>}
 *       {isAuthenticated && <div>Welcome, {user.full_name}!</div>}
 *     </form>
 *   );
 * }
 */
