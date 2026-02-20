'use strict';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

const toArray = (value) => (Array.isArray(value) ? value : [value]);

const fnName = (fn) => {
  if (!fn) return 'anonymous';
  return fn.name && fn.name.length > 0 ? fn.name : 'anonymous';
};

const joinPath = (...segments) => {
  const raw = segments
    .filter((segment) => segment !== undefined && segment !== null)
    .join('/');

  const normalized = raw
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/g, '')
    .replace(/^([^/])/, '/$1');

  return normalized.length === 0 ? '/' : normalized;
};

const renderBar = (value, total, width = 28) => {
  if (!total) return `[${'-'.repeat(width)}] 0`;
  const filled = Math.round((value / total) * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(Math.max(width - filled, 0))}] ${value}`;
};

const buildMethodBreakdown = (routes) => {
  const counts = new Map();

  for (const method of HTTP_METHODS) {
    counts.set(method, 0);
  }

  for (const route of routes) {
    counts.set(route.method, (counts.get(route.method) || 0) + 1);
  }

  return counts;
};

const describeRoute = (route, seenKeys) => {
  const key = `${route.method} ${route.path}`;
  const hasHandler = route.handlers.length > 0;
  const duplicate = seenKeys.has(key);

  if (!hasHandler) return 'failed';
  if (duplicate) return 'duplicate';
  return 'ok';
};

const classifyAccess = (middlewareNames, authHits) => {
  const normalized = middlewareNames.map((name) => name.toLowerCase());
  const protectedMarkers = ['authenticate', 'requireadmin', 'requirerole'];

  const protectedRoute =
    authHits > 0 ||
    protectedMarkers.some((marker) => normalized.some((name) => name.includes(marker)));

  return protectedRoute ? 'protected' : 'public';
};

const hasAuthReference = (candidate, authMiddlewareSet) => {
  if (!candidate || !(authMiddlewareSet instanceof Set) || authMiddlewareSet.size === 0) {
    return false;
  }
  return authMiddlewareSet.has(candidate);
};

const collectRoutesFromRouter = (router, rootPrefix = '', authMiddlewareSet = new Set()) => {
  const routes = [];
  const stack = router && router.stack ? router.stack : [];

  const activeMiddleware = [];
  let activeAuthCount = 0;

  for (const layer of stack) {
    if (!layer.route) {
      const middlewareFns = toArray(layer.handle);
      const names = middlewareFns.map(fnName).filter((name) => name !== 'router');

      if (names.length > 0) {
        activeMiddleware.push(...names);
      }
      activeAuthCount += middlewareFns.filter((candidate) =>
        hasAuthReference(candidate, authMiddlewareSet)
      ).length;
      continue;
    }

    const routePath = joinPath(rootPrefix, layer.route.path);
    const methods = Object.keys(layer.route.methods || {})
      .filter((method) => layer.route.methods[method])
      .map((method) => method.toUpperCase());

    const routeLayers = layer.route.stack || [];
    const routeHandlers = routeLayers.map((routeLayer) => fnName(routeLayer.handle));
    const routeAuthCount = routeLayers.filter((routeLayer) =>
      hasAuthReference(routeLayer.handle, authMiddlewareSet)
    ).length;
    const middlewareChain = [...activeMiddleware, ...routeHandlers];
    const access = classifyAccess(middlewareChain, activeAuthCount + routeAuthCount);

    for (const method of methods) {
      routes.push({
        method,
        path: routePath,
        access,
        middleware: middlewareChain,
        handlers: routeHandlers.filter((name) => name !== 'anonymous'),
      });
    }
  }

  return routes;
};

const analyzeRoutes = (routeGroups, apiPrefix = '/api/v1', options = {}) => {
  const authMiddlewareSet = new Set(options.authMiddleware || []);
  const accessResolver = options.accessResolver;
  const allRoutes = [];

  for (const group of routeGroups) {
    const groupPrefix = joinPath(apiPrefix, group.base);
    let groupRoutes = [];
    try {
      groupRoutes = collectRoutesFromRouter(group.router, groupPrefix, authMiddlewareSet).map((route) => ({
        ...route,
        group: group.label || group.base,
      }));
    } catch (error) {
      groupRoutes = [
        {
          method: 'N/A',
          path: joinPath(groupPrefix || '/'),
          access: 'unknown',
          middleware: [],
          handlers: [],
          group: group.label || group.base,
          status: 'error',
          error: error.message,
        },
      ];
    }

    allRoutes.push(...groupRoutes);
  }

  const seenKeys = new Set();
  let failed = 0;
  let duplicate = 0;
  let erroneous = 0;
  let accessible = 0;
  let protectedCount = 0;

  const annotated = allRoutes.map((route) => {
    try {
      if (route.status === 'error') {
        erroneous += 1;
        return route;
      }

      const status = describeRoute(route, seenKeys);
      const key = `${route.method} ${route.path}`;
      if (status !== 'duplicate') {
        seenKeys.add(key);
      }
      const resolvedAccess =
        typeof accessResolver === 'function'
          ? accessResolver(route) || route.access
          : route.access;

      if (status === 'failed') failed += 1;
      if (status === 'duplicate') duplicate += 1;
      if (resolvedAccess === 'public') accessible += 1;
      if (resolvedAccess === 'protected') protectedCount += 1;

      return { ...route, access: resolvedAccess, status };
    } catch (error) {
      erroneous += 1;
      return { ...route, status: 'error', error: error.message };
    }
  });

  const summary = {
    total: annotated.length,
    available: annotated.filter((route) => route.status === 'ok').length,
    accessible,
    protected: protectedCount,
    failed,
    duplicate,
    erroneous,
  };

  return {
    summary,
    routes: annotated,
    methodBreakdown: buildMethodBreakdown(annotated),
  };
};

const formatRouteDiagnostics = (report) => {
  const lines = [];
  const total = report.summary.total || 1;

  lines.push('Route Diagnostics');
  lines.push('=================');
  lines.push(`Available   ${renderBar(report.summary.available, total)}`);
  lines.push(`Accessible  ${renderBar(report.summary.accessible, total)}`);
  lines.push(`Protected   ${renderBar(report.summary.protected, total)}`);
  lines.push(`Failed      ${renderBar(report.summary.failed, total)}`);
  lines.push(`Duplicate   ${renderBar(report.summary.duplicate, total)}`);
  lines.push(`Erroneous   ${renderBar(report.summary.erroneous, total)}`);
  lines.push('');
  lines.push('Method Distribution');
  lines.push('-------------------');

  for (const [method, count] of report.methodBreakdown.entries()) {
    if (count > 0) {
      lines.push(`${method.padEnd(7)} ${renderBar(count, total, 20)}`);
    }
  }

  lines.push('');
  lines.push('Route Matrix');
  lines.push('------------');
  lines.push('METHOD  STATUS     ACCESS     PATH');

  for (const route of report.routes.sort((a, b) => a.path.localeCompare(b.path))) {
    lines.push(
      `${route.method.padEnd(7)}${route.status.padEnd(11)}${route.access.padEnd(11)}${route.path}`
    );
  }

  return lines.join('\n');
};

module.exports = {
  analyzeRoutes,
  formatRouteDiagnostics,
};
