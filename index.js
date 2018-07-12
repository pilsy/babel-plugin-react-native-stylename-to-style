var nodePath = require("path");

function getExt(node) {
  return nodePath.extname(node.source.value).replace(/^\./, "");
}

module.exports = function(babel) {
  var className = null;
  var style = null;
  var specifier = null;
  var randomSpecifier = null;
  var t = babel.types;

  function generateRequire(expression) {
    var require = t.callExpression(t.identifier("require"), [
      t.stringLiteral("react-native-dynamic-style-processor")
    ]);
    expression.object = t.callExpression(
      t.memberExpression(require, t.identifier("process")),
      [expression.object]
    );
    return expression;
  }

  function getStylesFromClassNames(classNames) {
    return classNames
      .map(c => {
        var parts = c.split(".");
        var hasParts = parts[0] !== undefined && parts[1] !== undefined;

        if (specifier && !hasParts) {
          return;
        }

        var obj = hasParts ? parts[0] : randomSpecifier.local.name;
        var prop = hasParts ? parts[1] : c;
        var hasHyphen = /\w+-\w+/.test(prop) === true;

        var memberExpression = t.memberExpression(
          t.identifier(obj),
          hasHyphen ? t.stringLiteral(prop) : t.identifier(prop),
          hasHyphen
        );
        return generateRequire(memberExpression);
      })
      .filter(e => e !== undefined);
  }

  // Support dynamic className
  // TODO: Add support for multiple named imports
  // TODO: Move into a standalone require'able function instead of doing the inline invocation
  // Generates the following:
  //   className={x}
  //   | | |
  //   V V V
  //
  //   className={
  //     (x || '').split(' ').filter(Boolean).map(function(name) {
  //       return require('react-native-dynamic-style-processor').process(_Button2.default)[name]
  //     }
  //   }
  // The current drawbacks are:
  //   - can be used when there is only one style import
  //   - even when the single style import is named, that name should not be
  //     present in expression calculation.
  //     Example:
  //       import foo from './Button.css'
  //       let x = 'wrapper' // NOT 'foo.wrapper'
  //       <View className={x} />
  function getStyleFromExpression(expression) {
    var obj = (specifier || randomSpecifier).local.name;
    var expressionResult = t.logicalExpression("||", expression, t.stringLiteral(""));
    var split = t.callExpression(
      t.memberExpression(expressionResult, t.identifier("split")),
      [t.stringLiteral(" ")]
    );
    var filter = t.callExpression(
      t.memberExpression(split, t.identifier("filter")),
      [t.identifier('Boolean')]
    );
    var nameIdentifier = t.identifier('name');
    var styleMemberExpression = t.memberExpression(
      t.identifier(obj),
      nameIdentifier,
      true
    );
    var aRequire = generateRequire(styleMemberExpression);
    var map = t.callExpression(
      t.memberExpression(filter, t.identifier("map")),
      [t.functionExpression(
        null,
        [nameIdentifier],
        t.blockStatement([
          t.returnStatement(aRequire)
        ])
      )]
    );
    return map;
  }

  return {
    post() {
      randomSpecifier = null;
    },
    visitor: {
      ImportDeclaration: function importResolver(path, state) {
        var extensions =
          state.opts != null &&
          Array.isArray(state.opts.extensions) &&
          state.opts.extensions;

        if (!extensions) {
          throw new Error(
            "You have not specified any extensions in the plugin options."
          );
        }

        var node = path.node;

        var anonymousImports = path.container.filter(n => {
          return (
            t.isImportDeclaration(n) &&
            n.specifiers.length === 0 &&
            extensions.indexOf(getExt(n)) > -1
          );
        });

        if (anonymousImports.length > 1) {
          throw new Error(
            "Cannot use anonymous style name with more than one stylesheet import."
          );
        }

        if (extensions.indexOf(getExt(node)) === -1) {
          return;
        }

        specifier = node.specifiers[0];

        randomSpecifier = t.ImportDefaultSpecifier(
          path.scope.generateUidIdentifier()
        );

        node.specifiers = [specifier || randomSpecifier];
      },
      JSXOpeningElement: {
        exit(path, state) {
          var expressions = null;

          if (
            className === null ||
            randomSpecifier === null ||
            !(t.isStringLiteral(className.node.value) ||
            t.isJSXExpressionContainer(className.node.value))
          ) {
            return;
          }

          if (t.isStringLiteral(className.node.value)) {
            var classNames = className.node.value.value
              .split(" ")
              .filter(v => v.trim() !== "");
            expressions = getStylesFromClassNames(classNames);
          } else if (t.isJSXExpressionContainer(className.node.value)) {
            expressions = [getStyleFromExpression(className.node.value.expression)];
          }

          var hasclassNameAndStyle =
            className &&
            style &&
            className.parentPath.node === style.parentPath.node;

          if (hasclassNameAndStyle) {
            style.node.value = t.arrayExpression(
              expressions.concat([style.node.value.expression])
            );
            className.remove();
          } else {
            if (expressions.length > 1) {
              className.node.value = t.arrayExpression(expressions);
            } else {
              className.node.value = expressions[0];
            }
            className.node.name.name = "style";
          }
          style = null;
          className = null;
          specifier = null;
        }
      },
      JSXAttribute: function JSXAttribute(path, state) {
        var name = path.node.name.name;
        if (name === "className") {
          className = path;
        } else if (name === "style") {
          style = path;
        }
      }
    }
  };
};
